# Dicere - Digital Speech Coach

"Dicere" (Latin: "to speak") is a hackathon project that helps users improve their public speaking by analyzing filler words and pauses.

## Project Structure

- `frontend/`: React + Vite application
- `backend/`: Python + FastAPI server

## Setup Instructions

### Prerequisites
- Node.js (v18+)
- Python (v3.9+)
- AssemblyAI API Key (Get one for free at [assemblyai.com](https://www.assemblyai.com/))

### 1. Backend Setup

1. Navigate to the `backend` folder:
   ```bash
   cd backend
   ```
2. Create a virtual environment (optional but recommended):
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Configure API Key:
   - Open `.env` file.
   - Replace `your_assemblyai_api_key_here` with your actual AssemblyAI API key.

5. Run the server:
   ```bash
   python main.py
   ```
   The server will start at `http://0.0.0.0:8000`.

### 2. Frontend Setup

1. Open a new terminal and navigate to the `frontend` folder:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
4. Open the link shown (usually `http://localhost:5173`) in your browser.

## How to Use

1. Click **Start Recording** and answer the question displayed.
2. Click **Stop & Analyze** when you are done.
3. Wait for the analysis (it may take a few seconds to upload and transcribe).
4. Review your **Fluency Score**, **WPM**, and the transcript with highlighted filler words and pauses.
5. Proceed to the next question.

## Tech Stack

- **Frontend**: React, Vite
- **Backend**: FastAPI
- **Speech Recognition**: AssemblyAI (with `disfluencies=True` for filler word detection)

## Scoring System
- **Base Score**: 100
- **Penalties**:
  - Fillers (um, uh): -2 points each
  - Fillers (like): -1 point each
  - Pauses (> 2s): -5 points each
  - WPM (Target 100-180): -10 points if outside range
