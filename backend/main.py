import os
import requests
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For hackathon, allow all. In prod, lock this down.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_KEY = os.getenv("ASSEMBLYAI_API_KEY")
UPLOAD_ENDPOINT = "https://api.assemblyai.com/v2/upload"
TRANSCRIPT_ENDPOINT = "https://api.assemblyai.com/v2/transcript"

def upload_to_assemblyai(audio_data):
    headers = {'authorization': API_KEY}
    response = requests.post(UPLOAD_ENDPOINT, headers=headers, data=audio_data)
    if response.status_code != 200:
        print(f"Upload Error: {response.status_code}, {response.text}")
        raise HTTPException(status_code=response.status_code, detail="Failed to upload audio to AssemblyAI")
    return response.json()['upload_url']

def transcribe_audio(upload_url):
    headers = {
        'authorization': API_KEY,
        'content-type': 'application/json'
    }
    json_data = {
        'audio_url': upload_url,
        'disfluencies': True, # Vital for detecting ums/uhs
        'speaker_labels': False,
        'speech_models': ["universal-3-pro", "universal-2"],
        'sentiment_analysis': True
    }
    response = requests.post(TRANSCRIPT_ENDPOINT, headers=headers, json=json_data)
    if response.status_code != 200:
         print(f"Transcript Error: {response.status_code}, {response.text}")
         raise HTTPException(status_code=response.status_code, detail="Failed to start transcription")
    return response.json()['id']

def get_transcription_result(transcript_id):
    headers = {'authorization': API_KEY}
    
    # Polling logic would be better on client or background task, 
    # but for a simple synchronous request in a hackathon, we might block (not ideal for long audio)
    # OR we return the ID and let the frontend poll.
    # Given the blueprint asks for "The API returns a JSON transcript", 
    # let's implement a simple polling loop here for simplicity, 
    # or better, just return the ID if we want to be non-blocking.
    
    # HOWEVER, the blueprint implies immediate processing: "@app.post('/analyze')... returns {score: ...}"
    # So we will block and poll until complete.
    import time
    polling_endpoint = f"{TRANSCRIPT_ENDPOINT}/{transcript_id}"
    
    while True:
        response = requests.get(polling_endpoint, headers=headers)
        status = response.json()['status']
        if status == 'completed':
            return response.json()
        elif status == 'error':
            raise HTTPException(status_code=500, detail="Transcription failed")
        time.sleep(0.25) # Poll more frequently (0.25s) to reduce wait time

@app.post("/analyze")
async def analyze_audio(file: UploadFile = File(...)):
    if not API_KEY:
        print("Error: API Key missing")
        raise HTTPException(status_code=500, detail="AssemblyAI API Key not configured")

    print(f"Received file: {file.filename}, Content-Type: {file.content_type}")

    # 1. Upload file
    # Read content to ensure requests handles it correctly
    content = await file.read()
    upload_url = upload_to_assemblyai(content)
    
    # 2. Start Transcription
    transcript_id = transcribe_audio(upload_url)
    
    # 3. Wait for Result
    result = get_transcription_result(transcript_id)
    
    # 4. Extract Data
    words = result.get('words', [])
    transcript_text = result.get('text', "")
    
    # 5. Analyze for Fillers
    filler_count = 0
    # Common fillers. AssemblyAI with disfluencies=True captures 'um', 'uh', 'hmm', etc.
    # We can be broader if needed.
    fillers = ['um', 'umm', 'uh', 'huh', 'uhh', 'like', 'hmm', 'mhm', 'you know', 'actually', 'basically', 'right', 'well']
    detected_fillers = []
    
    for word in words:
        clean_word = word['text'].lower().replace('.', '').replace(',', '')
        if clean_word in fillers:
            filler_count += 1
            detected_fillers.append(word)

    # 6. Analyze for Pauses
    long_pauses = 0
    pause_threshold = 1.5 # seconds (based on blueprint)
    
    detected_pauses = []
    
    for i in range(len(words) - 1):
        # word['end'] is in milliseconds from AssemblyAI? 
        # Let's check AssemblyAI docs memory... 
        # AssemblyAI returns 'start' and 'end' in milliseconds.
        
        end_current = words[i]['end'] 
        start_next = words[i+1]['start']
        gap_ms = start_next - end_current
        gap_sec = gap_ms / 1000.0
        
        if gap_sec > pause_threshold:
            long_pauses += 1
            detected_pauses.append({
                "after_word_index": i,
                "duration": gap_sec
            })

    # 7. Calculate Breakdown Scores
    
    # --- Pacing (WPM) ---
    # We calculate WPM based on the "active speech" duration (first word start to last word end).
    audio_duration_sec = result.get('audio_duration', 0)
    
    if len(words) > 0:
        start_ms = words[0]['start']
        end_ms = words[-1]['end']
        active_duration_ms = end_ms - start_ms
        
        # Add a small "breathing buffer" (e.g., 0.5s on each side) to prevent 
        # short sentences from having artificially high WPM due to lack of pauses.
        # This makes the WPM metric more robust for short hackathon demos.
        adjusted_duration_ms = active_duration_ms + 1000 
        
        if adjusted_duration_ms > 0:
            audio_duration_sec = adjusted_duration_ms / 1000.0

    audio_duration_min = audio_duration_sec / 60.0 if audio_duration_sec > 0 else 1
    total_words_count = len(words)
    wpm = total_words_count / audio_duration_min if audio_duration_min > 0 else 0
    min_wpm = 130
    max_wpm = 170
    wpm_score = 100
    wpm_feedback = "Perfect pacing."
    if wpm < min_wpm:
        diff = min_wpm - wpm
        wpm_score = max(0, 100 - diff) # 1 point off per unit
        wpm_feedback = f"Your pace is too slow. Aim for {min_wpm}-{max_wpm} WPM for the clearest speech."
    elif wpm > max_wpm:
        diff = wpm - max_wpm
        wpm_score = max(0, 100 - diff)
        wpm_feedback = f"Your pace is too fast. Slow down to {min_wpm}-{max_wpm} WPM for the clearest speech."
    # --- Fillers ---
    # Heuristic: < 2 fillers is 100. Then steep penalty.
    # Weighted penalty
    filler_penalty = 0
    for word in detected_fillers:
        text = word['text'].lower().replace('.', '').replace(',', '')
        if text in ['um', 'uh']:
            filler_penalty += 5
        elif text == 'like':
            filler_penalty += 3
        else:
            filler_penalty += 2
            
    filler_score = max(0, 100 - filler_penalty)
    if filler_score == 100:
        filler_feedback = "Excellent! No filler words detected."
    elif filler_score > 80:
        filler_feedback = "A few filler words were detected, try to reduce usage of them."
    else:
        filler_feedback = f"High filler usage detected ({len(detected_fillers)} found)."

    # --- Pauses ---
    # Long pause > 1.5s is -15
    long_pause_penalty_count = 0
    pause_threshold_for_penalty = pause_threshold # seconds
    for pause in detected_pauses:
        if pause['duration'] > pause_threshold_for_penalty:
            long_pause_penalty_count += 1
            
    pause_score = max(0, 100 - (long_pause_penalty_count * 15))
    if pause_score == 100:
        if len(detected_pauses) == 0:
             pause_feedback = "Flow is continuous, great job!"
        else:
             pause_feedback = "A few pauses are natural, but be cognizant of them."
    elif pause_score > 70:
        pause_feedback = "Awkward pauses detected, aim to talk with confidence."
    else:
        pause_feedback = f"Minimize long silences (>{pause_threshold_for_penalty}s) to maintain engagement."

    # --- Sentiment ---
    sentiment_results = result.get('sentiment_analysis_results', [])
    negative_count = 0
    total_sentences = len(sentiment_results)
    sentiment_score = 100
    
    if total_sentences > 0:
        for sent in sentiment_results:
            if sent['sentiment'] == 'NEGATIVE':
                negative_count += 1
        
        neg_ratio = negative_count / total_sentences
        # Penalty if > 10% negative
        if neg_ratio > 0.1:
             sentiment_score = max(0, 100 - int(neg_ratio * 100))
    
    if sentiment_score >= 90:
        sentiment_feedback = "Tone is positive and professional."
    elif sentiment_score > 70:
        sentiment_feedback = "Tone is mostly okay, but some negativity detected."
    else:
        sentiment_feedback = "Watch your tone - significant negative sentiment detected."

    # --- Overall ---
    # Weighted Average? Or simple average.
    # Let's do simple average for clarity.
    overall_score = int((wpm_score + filler_score + pause_score + sentiment_score) / 4)
    
    # Construct combined feedback
    final_feedback = f"{wpm_feedback} {filler_feedback} {pause_feedback} {sentiment_feedback}"

    return {
        "score": overall_score,
        "wpm": round(wpm, 1),
        "fillers_detected": filler_count,
        "long_pauses": long_pauses,
        "category_scores": {
            "pacing": wpm_score,
            "fillers": filler_score,
            "pauses": pause_score,
            "sentiment": sentiment_score
        },
        "category_feedback": {
            "pacing": wpm_feedback,
            "fillers": filler_feedback,
            "pauses": pause_feedback,
            "sentiment": sentiment_feedback
        },
        "sentiment_stats": {
            "negative_sentences": negative_count,
            "total_sentences": total_sentences
        },
        "feedback": final_feedback,
        "transcript_text": transcript_text,
        "words": words, 
        "detailed_pauses": detected_pauses
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
