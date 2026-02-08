import { useState, useRef } from 'react'
import './App.css'
import Aurora from './Aurora'

const QUESTIONS = [
  // --- Standard / General ---
  "Tell me about yourself.",
  "What is your greatest weakness?",
  "Why do you want this role?",
  "Where do you see yourself in five years?",
  "What motivates you to come to work every day?",

  // --- Behavioral (STAR Method) ---
  "Describe a time you had to manage a conflict with a coworker.",
  "Tell me about a time you failed. How did you handle it?",
  "Describe a situation where you had to meet a tight deadline with limited resources.",
  "Give me an example of a time you showed leadership without being the formal manager.",
  "Tell me about a time you disagreed with a supervisor's decision.",

  // --- Creative / Cultural Fit ---
  "If you were a brand, what would your slogan be?",
  "Teach me something involved in your hobby in less than two minutes.",
  "If we gave you a grant of $1 million to solve a problem in the world, what would you solve?",
  "What is the last new thing you learned outside of work?",
  "If you were a kitchen appliance, which one would you be and why?",

  // --- Riddles / Logic / Brain Teasers ---
  "Why are manhole covers round?",
  "You have a 3-gallon jug and a 5-gallon jug, and an unlimited supply of water. How do you measure exactly 4 gallons?",
  "A man pushes his car to a hotel and tells the owner he's bankrupt. Why?",
  "How many piano tuners are there in New York City?",
  "You are in a room with three light switches, each controlling one of three light bulbs in the next room. You can only enter the room once. How do you determine which switch controls which bulb?"
];

function App() {
  const [questionIndex, setQuestionIndex] = useState(0);
  const [sessionQuestions, setSessionQuestions] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionResults, setSessionResults] = useState([]);
  const [viewState, setViewState] = useState('landing'); // 'landing', 'question', 'analyzing', 'feedback', 'finished'
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimeoutRef = useRef(null);

  const startAssessment = () => {
    // Select 4 random questions
    const shuffled = [...QUESTIONS].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, 4);
    setSessionQuestions(selected);
    setQuestionIndex(0);
    setViewState('question');
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = handleStop;
      mediaRecorderRef.current.start();
      setIsRecording(true);

      // Auto-stop after 1 minute
      if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
          stopRecording();
          alert("Recording stopped automatically after 1 minute.");
        }
      }, 60000);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone.");
    }
  };

  const stopRecording = () => {
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }

    if (mediaRecorderRef.current && (isRecording || mediaRecorderRef.current.state === "recording")) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setViewState('analyzing');
    }
  };

  const handleStop = async () => {
    setIsLoading(true);
    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.wav');

    try {
      // Use environment variable for backend URL, fallback to localhost
      const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
      const response = await fetch(`${BACKEND_URL}/analyze`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let errorMessage = `Server responded with ${response.status}`;
        try {
            const errorData = await response.json();
            if (errorData.error) errorMessage += `: ${errorData.error}`;
            else if (errorData.detail) errorMessage += `: ${errorData.detail}`;
        } catch (e) {
            errorMessage += ` (${response.statusText})`;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      setAnalysisResult(data);
      setSessionResults(prev => [...prev, { question: sessionQuestions[questionIndex], result: data }]);
      setViewState('feedback');
    } catch (error) {
      console.error("Error analyzing audio:", error);
      const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
      alert(`Error processing audio:\n${error.message}\n\nBackend URL: ${BACKEND_URL}/analyze`);
      setViewState('question');
    } finally {
      setIsLoading(false);
    }
  };

  const handleNext = () => {
    if (questionIndex < sessionQuestions.length - 1) {
      setQuestionIndex(prev => prev + 1);
      setAnalysisResult(null);
      setViewState('question');
    } else {
      setViewState('finished');
    }
  };

  const renderTranscript = () => {
    if (!analysisResult) return null;
    
    const { words, detailed_pauses } = analysisResult;
    // We need to rebuild the text with visual cues.
    
    // Create a map/lookup for pauses
    // detailed_pauses: [{after_word_index: 0, duration: 2.5}, ...]
    const pauseMap = {};
    if (detailed_pauses) {
        detailed_pauses.forEach(p => {
            pauseMap[p.after_word_index] = p.duration;
        });
    }

    // Match backend list
    const fillers = ['um', 'umm', 'uh', 'huh', 'uhh', 'like', 'hmm', 'mhm', 'actually', 'basically', 'right', 'well'];

    return (
      <div className="transcript-box">
        {words.map((wordObj, idx) => {
          const isFiller = fillers.includes(wordObj.text.toLowerCase().replace(/[.,]/g, ''));
          // Check if there is a pause AFTER this word
          const pauseDuration = pauseMap[idx];
          
          return (
            <span key={idx}>
              <span className={isFiller ? "filler-word" : ""}>
                {wordObj.text}{" "}
              </span>
              {pauseDuration && (
                <span className="pause-marker">
                   [{pauseDuration.toFixed(1)}s PAUSE]
                </span>
              )}
            </span>
          );
        })}
      </div>
    );
  };

  const auroraBg = (
    <Aurora
      colorStops={["#120b2c","#37005c","#1a0f24"]}
      blend={0.74}
      amplitude={0.8}
      speed={0.5}
    />
  );

  if (viewState === 'landing') {
    return (
      <>
        {auroraBg}
        <div className="landing-container">
          {/* A. Hero Section */}
        <section className="hero-section">
            <header className="hero-header">
                <h1>Dicere</h1>
            </header>
            <div className="hero-content">
                <h2 className="headline">Speak with Confidence.</h2>
                <h3 className="sub-headline">
                    Dicere is your personal AI speech coach. Eliminate filler words, master your pacing, and improve your articulation in just 2 minutes.
                </h3>
                <button className="cta-btn primary-btn" onClick={startAssessment}>
                    Start Assessment
                </button>
            </div>
        </section>

        {/* B. "What is Dicere?" Section */}
        <section className="info-section">
            <h2>The Science of Speaking</h2>
            <p className="section-body">
                Public speaking is a skill, not a talent. Dicere uses advanced speech recognition to break down your speaking patterns. We analyze the invisible metrics of communication—from hesitation markers to tonal sentiment—giving you data-driven feedback to land your next interview or presentation.
            </p>
        </section>

        {/* C. "How It Works" Section */}
        <section className="steps-section">
            <h2>How It Works</h2>
            <div className="steps-grid">
                <div className="step-card">
                    <h3>Step 1: The Interview</h3>
                    <p>Answer 4 randomly selected behavioral questions from our question bank.</p>
                </div>
                <div className="step-card">
                    <h3>Step 2: The Analysis</h3>
                    <p>Our AI processes your audio for disfluencies (um, uh, like), pacing (WPM), and pauses, and tone indicators using sentiment analysis.</p>
                </div>
                <div className="step-card">
                    <h3>Step 3: The Feedback</h3>
                    <p>Once your speech is analyzed, receive an instant fluency score and actionable tips to improve.</p>
                </div>
            </div>
        </section>
      </div>
    </>
    );
  }

  if (viewState === 'finished') {
     // Calculate average score
     const avgScore = sessionResults.length > 0 
        ? sessionResults.reduce((acc, curr) => acc + curr.result.score, 0) / sessionResults.length
        : 0;

     // Calculate category averages
     const cats = { pacing: 0, fillers: 0, pauses: 0, sentiment: 0 };
     let hasCategoryData = false;

     if (sessionResults.length > 0) {
        sessionResults.forEach(item => {
            if (item.result.category_scores) {
                hasCategoryData = true;
                cats.pacing += item.result.category_scores.pacing;
                cats.fillers += item.result.category_scores.fillers;
                cats.pauses += item.result.category_scores.pauses;
                cats.sentiment += item.result.category_scores.sentiment;
            }
        });
        
        if (hasCategoryData) {
            cats.pacing = Math.round(cats.pacing / sessionResults.length);
            cats.fillers = Math.round(cats.fillers / sessionResults.length);
            cats.pauses = Math.round(cats.pauses / sessionResults.length);
            cats.sentiment = Math.round(cats.sentiment / sessionResults.length);
        }
     }

     return (
        <>
            {auroraBg}
            <div className="container">
                <h1>Session Complete</h1>
                <div className="card">
                    <h2>Average Fluency Score: {Math.round(avgScore)}</h2>
                    
                    {hasCategoryData && (
                        <div className="category-grid">
                            <div className="category-item">
                                <div className="cat-label">Pacing</div>
                                <div className="cat-value">{cats.pacing}</div>
                            </div>
                            <div className="category-item">
                                <div className="cat-label">Fillers</div>
                                <div className="cat-value">{cats.fillers}</div>
                            </div>
                            <div className="category-item">
                                <div className="cat-label">Pauses</div>
                                <div className="cat-value">{cats.pauses}</div>
                            </div>
                            <div className="category-item">
                                <div className="cat-label">Sentiment</div>
                                <div className="cat-value">{cats.sentiment}</div>
                            </div>
                        </div>
                    )}

                    <p className="completion-message">Great practice session! Keep improving your flow.</p>
                    <div className="results-list">
                        {sessionResults.map((item, i) => (
                            <div key={i} className="result-item">
                                <strong>Q{i+1}: {item.question}</strong>
                                <div className="result-score">Score: {item.result.score}</div>
                            </div>
                        ))}
                    </div>
                    <button className="primary-btn" onClick={() => window.location.reload()}>Start New Session</button>
                </div>
            </div>
        </>
     )
  }

  return (
    <>
        {auroraBg}
        <div className="container">
        <header>
            <h1>Dicere</h1>
            <p>Your Digital Speech Coach</p>
        </header>
        
        <div className="card">
        {viewState === 'question' && (
          <>
            <div className="question">
              Q{questionIndex + 1}: {sessionQuestions[questionIndex]}
            </div>
            
            <div className="controls">
              {!isRecording ? (
                <button className="primary-btn" onClick={startRecording}>Start Recording</button>
              ) : (
                <button className="recording-btn" onClick={stopRecording}>Stop & Analyze</button>
              )}
            </div>
             {isRecording && <div className="recording-indicator">
                <span className="pulse"></span> Recording...
             </div>}
          </>
        )}

        {viewState === 'analyzing' && (
          <div className="loading">
             <h2>Analyzing your speech...</h2>
             <p>Detecting fillers and pauses.</p>
             {/* Spinner could go here */}
          </div>
        )}

        {viewState === 'feedback' && analysisResult && (
          <div className="feedback-view">
            <h2>Analysis Result</h2>
            
            <div className="score-display">
                <div className="score-item">
                    <span className="score-val">{analysisResult.score}</span>
                    <span>Fluency Score</span>
                </div>
                <div className="score-item">
                    <span className="score-val">{analysisResult.wpm}</span>
                    <span>WPM</span>
                </div>
            </div>

            <p><strong>Feedback:</strong> {analysisResult.feedback}</p>
            
            <div className="stats">
               <p>Fillers detected: {analysisResult.fillers_detected}</p>
               <p>Long pauses: {analysisResult.long_pauses}</p>
            </div>

            <h3>Transcript Analysis</h3>
            {renderTranscript()}

            <div className="action-area">
               <button className="primary-btn" onClick={handleNext}>
                 {questionIndex < QUESTIONS.length - 1 ? "Next Question" : "Finish Session"}
               </button>
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  )
}

export default App
