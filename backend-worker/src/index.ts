import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { SessionStorage } from './SessionStorage'

export { SessionStorage }

type Bindings = {
  ASSEMBLYAI_API_KEY: string
  SESSION_STORAGE: DurableObjectNamespace
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/*', cors())

app.get('/', (c) => c.text('Dicere Backend is running on Cloudflare Workers!'))

// Diagnosis endpoint
app.get('/analyze', (c) => c.json({ status: 'online', message: 'Send a POST request with a file to analyze audio.' }))

// Analysis Helper Functions (ported from Python)
const FILLERS = ['um', 'umm', 'uh', 'huh', 'uhh', 'like', 'hmm', 'mhm', 'you know', 'actually', 'basically', 'right', 'well']

async function uploadToAssemblyAI(audioData: ArrayBuffer, apiKey: string) {
  const response = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: { 'authorization': apiKey },
    body: audioData
  })

  if (!response.ok) {
    throw new Error(`Upload Error: ${response.status} ${await response.text()}`)
  }

  const data: any = await response.json()
  return data.upload_url
}

async function transcribeAudio(uploadUrl: string, apiKey: string) {
  const response = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      'authorization': apiKey,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      audio_url: uploadUrl,
      disfluencies: true,
      speaker_labels: false,
      speech_models: ["universal-3-pro", "universal-2"], // Fallback model included
      sentiment_analysis: true
    })
  })

  if (!response.ok) {
    throw new Error(`Transcript Start Error: ${response.status} ${await response.text()}`)
  }

  const data: any = await response.json()
  return data.id
}

async function getTranscriptionResult(transcriptId: string, apiKey: string) {
  const pollingEndpoint = `https://api.assemblyai.com/v2/transcript/${transcriptId}`
  
  while (true) {
    const response = await fetch(pollingEndpoint, {
      headers: { 'authorization': apiKey }
    })
    const data: any = await response.json()

    if (data.status === 'completed') {
      return data
    } else if (data.status === 'error') {
      throw new Error(`Transcription failed: ${data.error}`)
    }

    // Wait 500ms before next poll
    // In a worker, busy-waiting is bad, but await blocking is okayish for short times.
    // Ideally we use a Durable Object Alarm, but for < 1 min audio, this is usually acceptable.
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

function calculateScores(result: any) {
  const words = result.words || []
  const audioDurationSec = result.audio_duration || 0

  // --- Fillers ---
  const detectedFillers = []
  let fillerCount = 0

  for (const word of words) {
    const cleanWord = word.text.toLowerCase().replace(/[.,]/g, '')
    if (FILLERS.includes(cleanWord)) {
      fillerCount++
      detectedFillers.push(word)
    }
  }

  let fillerPenalty = 0
  for (const word of detectedFillers) {
    const text = word.text.toLowerCase().replace(/[.,]/g, '')
    if (['um', 'uh'].includes(text)) fillerPenalty += 5
    else if (text === 'like') fillerPenalty += 3
    else fillerPenalty += 2
  }
  const fillerScore = Math.max(0, 100 - fillerPenalty)
  
  let fillerFeedback = ""
  if (fillerScore === 100) fillerFeedback = "Excellent! No filler words detected."
  else if (fillerScore > 80) fillerFeedback = "A few filler words were detected, try to reduce usage of them."
  else fillerFeedback = `High filler usage detected (${detectedFillers.length} found).`


  // --- Pauses ---
  let longPauses = 0
  const pauseThreshold = 1.5
  const detectedPauses = []

  // AssemblyAI returns start/end in ms
  for (let i = 0; i < words.length - 1; i++) {
    const endCurrent = words[i].end
    const startNext = words[i + 1].start
    const gapSec = (startNext - endCurrent) / 1000.0

    if (gapSec > pauseThreshold) {
      longPauses++
      detectedPauses.push({
        after_word_index: i,
        duration: gapSec
      })
    }
  }

  let longPausePenaltyCount = detectedPauses.filter(p => p.duration > pauseThreshold).length
  const pauseScore = Math.max(0, 100 - (longPausePenaltyCount * 15))
  
  let pauseFeedback = ""
  if (pauseScore === 100) pauseFeedback = detectedPauses.length === 0 ? "Flow is continuous, great job!" : "A few pauses are natural, but be cognizant of them."
  else if (pauseScore > 70) pauseFeedback = "Awkward pauses detected, aim to talk with confidence."
  else pauseFeedback = `Minimize long silences (>${pauseThreshold}s) to maintain engagement.`

  // --- WPM ---
  let audioDurationMin = audioDurationSec / 60.0
  // Adjust duration logic from python: active speech duration
  if (words.length > 0) {
      const startMs = words[0].start
      const endMs = words[words.length - 1].end
      const activeDurationMs = endMs - startMs
      const adjustedDurationMs = activeDurationMs + 1000 // Buffer
      if (adjustedDurationMs > 0) {
          audioDurationMin = (adjustedDurationMs / 1000.0) / 60.0
      }
  }
  if (audioDurationMin <= 0) audioDurationMin = 1 // Avoid div by zero

  const wpm = words.length / audioDurationMin
  
  const minWpm = 130
  const maxWpm = 170
  let wpmScore = 100
  let wpmFeedback = "Perfect pacing."

  if (wpm < minWpm) {
      const diff = minWpm - wpm
      wpmScore = Math.max(0, 100 - diff)
      wpmFeedback = `Your pace is too slow. Aim for ${minWpm}-${maxWpm} WPM.`
  } else if (wpm > maxWpm) {
      const diff = wpm - maxWpm
      wpmScore = Math.max(0, 100 - diff)
      wpmFeedback = `Your pace is too fast. Slow down to ${minWpm}-${maxWpm} WPM.`
  }
  wpmScore = Math.floor(wpmScore) // Ensure integer

  // --- Sentiment ---
  const sentimentResults = result.sentiment_analysis_results || []
  let negativeCount = 0
  const totalSentences = sentimentResults.length
  let sentimentScore = 100

  if (totalSentences > 0) {
    negativeCount = sentimentResults.filter((s:any) => s.sentiment === 'NEGATIVE').length
    const negRatio = negativeCount / totalSentences
    if (negRatio > 0.1) {
      sentimentScore = Math.max(0, 100 - Math.floor(negRatio * 100))
    }
  }

  let sentimentFeedback = ""
  if (sentimentScore >= 90) sentimentFeedback = "Tone is positive and professional."
  else if (sentimentScore > 70) sentimentFeedback = "Tone is mostly okay, but some negativity detected."
  else sentimentFeedback = "Watch your tone - significant negative sentiment detected."


  // --- Overall ---
  const overallScore = Math.floor((wpmScore + fillerScore + pauseScore + sentimentScore) / 4)
  const finalFeedback = `${wpmFeedback} ${fillerFeedback} ${pauseFeedback} ${sentimentFeedback}`

  return {
    score: overallScore,
    wpm: Number(wpm.toFixed(1)),
    fillers_detected: fillerCount,
    long_pauses: longPauses,
    category_scores: {
      pacing: wpmScore,
      fillers: fillerScore,
      pauses: pauseScore,
      sentiment: sentimentScore
    },
    category_feedback: {
        pacing: wpmFeedback,
        fillers: fillerFeedback,
        pauses: pauseFeedback,
        sentiment: sentimentFeedback
    },
    sentiment_stats: {
        negative_sentences: negativeCount,
        total_sentences: totalSentences
    },
    feedback: finalFeedback.trim(),
    transcript_text: result.text || "",
    words: words,
    detailed_pauses: detectedPauses
  }
}

app.post('/analyze', async (c) => {
  const apiKey = c.env.ASSEMBLYAI_API_KEY
  if (!apiKey) {
    return c.json({ error: 'AssemblyAI API Key not configured' }, 500)
  }

  try {
    const body: any = await c.req.parseBody()
    const file = body['file']

    // Relaxed check for File/Blob
    if (!file) {
      return c.json({ error: 'No file uploaded named "file"' }, 400)
    }

    let arrayBuffer: ArrayBuffer;
    if (file instanceof File) {
        arrayBuffer = await file.arrayBuffer();
    } else if (file instanceof Blob) {
        arrayBuffer = await file.arrayBuffer();
    } else if (typeof file === 'string') { 
       // In case it comes as a string path or base64 (unlikely with multipart form-data but valid check)
       return c.json({ error: 'File received as string, expected binary' }, 400);
    } else {
        // Fallback or specific Hono handling
        return c.json({ error: 'Invalid file format received' }, 400);
    }
    
    // 1. Upload
    const uploadUrl = await uploadToAssemblyAI(arrayBuffer, apiKey)
    
    // 2. Transcribe
    const transcriptId = await transcribeAudio(uploadUrl, apiKey)
    
    // 3. Poll
    const result = await getTranscriptionResult(transcriptId, apiKey)
    
    // 4. Score
    const finalAnalysis = calculateScores(result)
    
    return c.json(finalAnalysis)

  } catch (err: any) {
    debugger; // Ensure we catch errors
    return c.json({ error: err.message }, 500)
  }
})

export default app
