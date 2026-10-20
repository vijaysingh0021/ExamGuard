
"""Opt-in single-frame analysis. Frames are not persisted by this service."""

import os

import numpy as np
from fastapi import FastAPI, UploadFile, HTTPException

app = FastAPI(title="SentinelExam AI service")

MODEL_PATH = os.getenv("YOLO_MODEL_PATH")

try:
    import cv2
    import mediapipe as mp

    MEDIAPIPE_READY = True
except ImportError:
    cv2 = None
    mp = None
    MEDIAPIPE_READY = False

try:
    from ultralytics import YOLO

    yolo = YOLO(MODEL_PATH) if MODEL_PATH and os.path.isfile(MODEL_PATH) else None
except Exception:
    yolo = None


@app.get("/health")
def health():
    return {
        "mediapipe": "ready" if MEDIAPIPE_READY else "unavailable",
        "phone_model": "ready" if yolo is not None else "unavailable",
        "looking_away": "not_implemented",
        "note": "Phone detection requires a compatible configured YOLO model."
    }


@app.post("/analyze")
async def analyze(frame: UploadFile):
    if not MEDIAPIPE_READY:
        raise HTTPException(503, "OpenCV or MediaPipe is unavailable")

    if frame.content_type and not frame.content_type.startswith("image/"):
        raise HTTPException(415, "Upload an image file")

    content = await frame.read()

    if not content:
        raise HTTPException(400, "Uploaded image is empty")

    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "Image exceeds the 10 MB limit")

    image = cv2.imdecode(
        np.frombuffer(content, dtype=np.uint8),
        cv2.IMREAD_COLOR
    )

    if image is None:
        raise HTTPException(400, "Invalid image")

    # Actual MediaPipe face detection on this frame.
    with mp.solutions.face_detection.FaceDetection(
        model_selection=0,
        min_detection_confidence=0.5
    ) as detector:
        result = detector.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))

    face_count = len(result.detections or [])

    # Run actual YOLO inference only when a model is configured.
    phone_detection = "unavailable"
    phone_confidence = None

    if yolo is not None:
        predictions = yolo.predict(
            source=image,
            conf=0.35,
            verbose=False
        )

        names = predictions[0].names
        boxes = predictions[0].boxes
        phone_scores = []

        if boxes is not None:
            for box in boxes:
                class_id = int(box.cls.item())
                class_name = str(names[class_id]).lower().replace("_", " ")

                # Match common phone labels; custom model labels may differ.
                if any(label in class_name for label in (
                    "cell phone", "cellphone", "mobile phone",
                    "mobile", "smartphone", "smart phone"
                )):
                    phone_scores.append(float(box.conf.item()))

        phone_detection = "detected" if phone_scores else "not_detected"

        if phone_scores:
            phone_confidence = round(max(phone_scores), 3)

    return {
        "face_presence": face_count > 0,
        "face_count": face_count,
        "multiple_faces": face_count > 1,
        "looking_away": "not_implemented",
        "phone_detection": phone_detection,
        "phone_confidence": phone_confidence,
        "disclosure": (
            "One uploaded frame was processed in memory. "
            "This endpoint does not save images or create incidents."
        )
    }
