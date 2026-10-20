"""Opt-in frame analysis. No video is persisted here; callers decide whether to retain disclosed evidence."""
import os
from fastapi import FastAPI, UploadFile, HTTPException
app = FastAPI(title="SentinelExam AI service")
MODEL_PATH = os.getenv("YOLO_MODEL_PATH")
try:
    import cv2, mediapipe as mp
    MEDIAPIPE_READY = True
except ImportError: MEDIAPIPE_READY = False
try:
    from ultralytics import YOLO
    yolo = YOLO(MODEL_PATH) if MODEL_PATH else None
except Exception: yolo = None
@app.get('/health')
def health(): return {"mediapipe": "ready" if MEDIAPIPE_READY else "unavailable", "phone_model": "ready" if yolo else "unavailable", "note": "Phone detection requires YOLO_MODEL_PATH. No claim is made without it."}
@app.post('/analyze')
async def analyze(frame: UploadFile):
    if not MEDIAPIPE_READY: raise HTTPException(503, 'MediaPipe is unavailable')
    # Integration boundary: decode a single disclosed frame, return face count/head-pose proxy and optional YOLO phone result.
    # Production deployment must authenticate callers and apply retention/deletion policy outside this stateless service.
    content = await frame.read()
    image = cv2.imdecode(__import__('numpy').frombuffer(content, __import__('numpy').uint8), cv2.IMREAD_COLOR)
    if image is None: raise HTTPException(400, 'Invalid image')
    return {"face_presence": "analysis_not_enabled", "multiple_faces": "analysis_not_enabled", "looking_away": "analysis_not_enabled", "phone_detection": "unavailable" if not yolo else "model_configured", "disclosure": "Frame was processed in memory; no continuous footage is recorded."}
