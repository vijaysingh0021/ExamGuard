"""Opt-in single-frame analysis. Frames are processed in memory, not persisted."""

import os
import hmac

import cv2
import mediapipe as mp
import numpy as np
from fastapi import FastAPI, UploadFile, HTTPException, Header, Depends
from pathlib import Path
from dotenv import load_dotenv

# Load only the repository root .env; the backend and AI process share the
# same private service token without putting it in browser-visible settings.
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)

app = FastAPI(title="ExamGuard AI service")


def require_service_auth(authorization: str | None = Header(default=None)):
    """Require the backend-only credential; never expose it to browser clients."""
    expected = os.getenv("AI_SERVICE_TOKEN", "")
    if len(expected) < 32:
        raise HTTPException(503, "AI service authentication is not configured")
    supplied = authorization or ""
    prefix = "Bearer "
    if not supplied.startswith(prefix) or not hmac.compare_digest(supplied[len(prefix):], expected):
        raise HTTPException(401, "Invalid service credential")
    return True

MODEL_PATH = os.getenv("YOLO_MODEL_PATH")

# Head-pose thresholds in degrees. These are initial configurable values.
YAW_THRESHOLD = float(os.getenv("HEAD_YAW_THRESHOLD", "25"))
PITCH_THRESHOLD = float(os.getenv("HEAD_PITCH_THRESHOLD", "20"))

try:
    from ultralytics import YOLO
    yolo = YOLO(MODEL_PATH) if MODEL_PATH and os.path.isfile(MODEL_PATH) else None
except Exception:
    yolo = None


@app.get("/health")
def health():
    return {
        "mediapipe": "ready",
        "phone_model": "ready" if yolo is not None else "unavailable",
        "looking_away": "ready",
        "multiple_faces": "ready",
        "head_pose_thresholds": {
            "yaw_degrees": YAW_THRESHOLD,
            "pitch_degrees": PITCH_THRESHOLD
        },
        "note": "Head orientation is an approximate review signal, not proof of misconduct."
    }


def estimate_head_pose(image, face_mesh):
    """Estimate head orientation from one face using six facial landmarks."""

    height, width = image.shape[:2]
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    result = face_mesh.process(rgb)

    if not result.multi_face_landmarks:
        return None

    # Do not estimate head pose when multiple faces make the candidate ambiguous.
    if len(result.multi_face_landmarks) != 1:
        return None

    landmarks = result.multi_face_landmarks[0].landmark

    # Nose, chin, left/right eye corners, left/right mouth corners.
    landmark_ids = [1, 152, 33, 263, 61, 291]

    image_points = np.array(
        [
            (landmarks[index].x * width, landmarks[index].y * height)
            for index in landmark_ids
        ],
        dtype=np.float64
    )

    # Approximate generic 3D face model points.
    model_points = np.array(
        [
            (0.0, 0.0, 0.0),
            (0.0, -330.0, -65.0),
            (-225.0, 170.0, -135.0),
            (225.0, 170.0, -135.0),
            (-150.0, -150.0, -125.0),
            (150.0, -150.0, -125.0)
        ],
        dtype=np.float64
    )

    focal_length = float(width)
    camera_matrix = np.array(
        [
            [focal_length, 0, width / 2],
            [0, focal_length, height / 2],
            [0, 0, 1]
        ],
        dtype=np.float64
    )

    distortion = np.zeros((4, 1), dtype=np.float64)

    success, rotation_vector, _ = cv2.solvePnP(
        model_points,
        image_points,
        camera_matrix,
        distortion,
        flags=cv2.SOLVEPNP_ITERATIVE
    )

    if not success:
        return None

    rotation_matrix, _ = cv2.Rodrigues(rotation_vector)
    angles = cv2.RQDecomp3x3(rotation_matrix)[0]

    pitch = float(angles[0])
    yaw = float(angles[1])
    roll = float(angles[2])

    return {
        "pitch_degrees": round(pitch, 2),
        "yaw_degrees": round(yaw, 2),
        "roll_degrees": round(roll, 2)
    }


@app.post("/analyze", dependencies=[Depends(require_service_auth)])
async def analyze(frame: UploadFile):
    if frame.content_type and not frame.content_type.startswith("image/"):
        raise HTTPException(415, "Upload an image file")

    content = await frame.read()

    if not content:
        raise HTTPException(400, "Uploaded image is empty")

    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(413, "Image exceeds the 5 MB limit")

    image = cv2.imdecode(
        np.frombuffer(content, dtype=np.uint8),
        cv2.IMREAD_COLOR
    )

    if image is None:
        raise HTTPException(400, "Invalid image")

    # Detect and count faces.
    with mp.solutions.face_detection.FaceDetection(
        model_selection=0,
        min_detection_confidence=0.5
    ) as detector:
        face_result = detector.process(
            cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        )

    face_count = len(face_result.detections or [])
    multiple_faces = face_count > 1

    # Estimate head pose only when exactly one face is present.
    head_pose = None
    looking_away = "unavailable"

    if face_count == 1:
        with mp.solutions.face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=2,
            refine_landmarks=False,
            min_detection_confidence=0.5
        ) as face_mesh:
            head_pose = estimate_head_pose(image, face_mesh)

        if head_pose is not None:
            turned_sideways = abs(head_pose["yaw_degrees"]) > YAW_THRESHOLD
            tilted_up_or_down = abs(head_pose["pitch_degrees"]) > PITCH_THRESHOLD

            looking_away = (
                "looking_away"
                if turned_sideways or tilted_up_or_down
                else "looking_forward"
            )

    # Run YOLO phone detection if a compatible model is configured.
    phone_detection = "unavailable"
    phone_confidence = None

    if yolo is not None:
        try:
            predictions = yolo.predict(
                source=image,
                conf=0.35,
                verbose=False
            )
        except Exception as exc:
            raise HTTPException(
                503,
                "Phone-detection model inference is unavailable"
            ) from exc

        names = predictions[0].names
        boxes = predictions[0].boxes
        phone_scores = []

        if boxes is not None:
            for box in boxes:
                class_id = int(box.cls.item())
                class_name = str(names[class_id]).lower().replace("_", " ")

                if any(label in class_name for label in (
                    "cell phone",
                    "cellphone",
                    "mobile phone",
                    "mobile",
                    "smartphone",
                    "smart phone"
                )):
                    phone_scores.append(float(box.conf.item()))

        phone_detection = "detected" if phone_scores else "not_detected"

        if phone_scores:
            phone_confidence = round(max(phone_scores), 3)

    return {
        "face_presence": face_count > 0,
        "face_count": face_count,
        "multiple_faces": multiple_faces,
        "looking_away": looking_away,
        "head_pose": head_pose,
        "phone_detection": phone_detection,
        "phone_confidence": phone_confidence,
        "service_version": "examguard-ai-local-v1",
        "phone_model": "configured" if yolo is not None else "unavailable",
        "disclosure": (
            "One uploaded frame was processed in memory. "
            "This endpoint does not save images or create incidents. "
            "Head orientation is an approximate signal, not eye-gaze tracking."
        )
    }
