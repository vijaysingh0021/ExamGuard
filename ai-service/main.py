"""Opt-in single-frame analysis. Frames are processed in memory, not persisted."""

import asyncio
from collections import deque
from contextlib import asynccontextmanager
import os
import hmac
import logging
import sys
import threading
import time
from math import ceil
from typing import AsyncGenerator

import cv2
import mediapipe as mp
import numpy as np
from fastapi import FastAPI, UploadFile, HTTPException, Header, Depends
from pathlib import Path
from dotenv import load_dotenv

# Load only the repository root .env; the backend and AI process share the
# same private service token without putting it in browser-visible settings.
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)

logger = logging.getLogger("examguard.ai")


def positive_int_setting(name: str, default: int, minimum: int = 1) -> int:
    value = int(os.getenv(name, str(default)))
    if value < minimum:
        raise ValueError(f"{name} must be at least {minimum}")
    return value


def nonnegative_float_setting(name: str, default: float) -> float:
    value = float(os.getenv(name, str(default)))
    if not np.isfinite(value) or value < 0:
        raise ValueError(f"{name} must be a finite non-negative number")
    return value


def positive_float_setting(name: str, default: float) -> float:
    value = float(os.getenv(name, str(default)))
    if not np.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be a finite positive number")
    return value


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
YAW_THRESHOLD = float(os.getenv("HEAD_YAW_THRESHOLD", "30"))
PITCH_THRESHOLD = float(os.getenv("HEAD_PITCH_THRESHOLD", "25"))
HEAD_POSE_MARGIN = float(os.getenv("HEAD_POSE_MARGIN", "5"))
PHONE_CONFIDENCE_THRESHOLD = float(os.getenv("PHONE_CONFIDENCE_THRESHOLD", "0.35"))
FACE_CONFIDENCE_THRESHOLD = float(os.getenv("FACE_CONFIDENCE_THRESHOLD", "0.5"))

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
MAX_SUPPORTED_FACE_COUNT = 20
SUPPORTED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_INFERENCE_SIDE = positive_int_setting("AI_MAX_INFERENCE_SIDE", 960, minimum=32)
INFERENCE_MIN_INTERVAL_SECONDS = nonnegative_float_setting("AI_INFERENCE_MIN_INTERVAL_SECONDS", 1.0)
INFERENCE_TIMEOUT_SECONDS = positive_float_setting("AI_INFERENCE_TIMEOUT_SECONDS", 10.0)
TORCH_NUM_THREADS = positive_int_setting("AI_TORCH_THREADS", 1)

MODEL_LOAD_ERROR = None
MODEL_CLASSES = {}
yolo = None
face_detector = None
face_mesh = None
_models_initialized = False
_model_initialization_lock = threading.Lock()
_inference_lock = threading.Lock()
_throttle_lock = threading.Lock()
_last_inference_started_at = 0.0
RECENT_INFERENCE_LATENCIES_MS = deque(maxlen=256)
_latency_history_lock = threading.Lock()
YOLO_DEVICE = "cpu"


def load_yolo_model(model_path: str):
    global YOLO_DEVICE

    from ultralytics import YOLO

    model = YOLO(model_path)
    YOLO_DEVICE = "cpu"
    if os.getenv("AI_USE_CUDA", "0") != "1":
        return model

    try:
        import torch

        if not torch.cuda.is_available():
            logger.info("CUDA was requested but is unavailable; using CPU inference")
            return model
        model.to("cuda")
        YOLO_DEVICE = "cuda"
        try:
            torch.backends.cudnn.benchmark = True
        except Exception as exc:  # pragma: no cover - depends on CUDA runtime
            logger.warning("Could not enable cuDNN benchmarking (%s)", type(exc).__name__)
        logger.info("YOLO model moved to CUDA for faster inference on supported hardware")
    except Exception as exc:  # pragma: no cover - depends on hardware availability
        logger.warning("CUDA acceleration for YOLO was unavailable (%s); using CPU inference", type(exc).__name__)
        try:
            model.to("cpu")
        except Exception as fallback_exc:
            logger.error("Could not restore YOLO model to CPU (%s)", type(fallback_exc).__name__)
            raise RuntimeError("YOLO could not be initialized on CUDA or CPU") from fallback_exc
    return model


def initialize_models() -> None:
    """Load each inference model once per process; readiness reflects partial failures."""
    global MODEL_CLASSES, MODEL_LOAD_ERROR, _models_initialized, face_detector, face_mesh, yolo

    with _model_initialization_lock:
        if _models_initialized:
            return
        _models_initialized = True
        errors = []

        cv2.setUseOptimized(True)
        cv2.setNumThreads(1)
        os.environ.setdefault("OMP_NUM_THREADS", str(TORCH_NUM_THREADS))
        os.environ.setdefault("MKL_NUM_THREADS", str(TORCH_NUM_THREADS))
        try:
            import torch

            torch.set_num_threads(TORCH_NUM_THREADS)
            try:
                torch.set_num_interop_threads(TORCH_NUM_THREADS)
            except RuntimeError as exc:
                logger.warning("Could not set PyTorch inter-op thread count (%s)", type(exc).__name__)
        except Exception as exc:
            logger.warning("PyTorch CPU thread configuration failed (%s)", type(exc).__name__)

        if MODEL_PATH and os.path.isfile(MODEL_PATH):
            try:
                yolo = load_yolo_model(MODEL_PATH)
                MODEL_CLASSES = class_names_by_id(yolo.names)
            except Exception as exc:
                errors.append(f"YOLO: {type(exc).__name__}")
                logger.error("YOLO model could not be loaded (%s)", type(exc).__name__)
        else:
            errors.append("YOLO weights unavailable")
            logger.error("YOLO model could not be loaded (weights path unavailable)")

        try:
            face_detector = mp.solutions.face_detection.FaceDetection(
                model_selection=1,
                min_detection_confidence=FACE_CONFIDENCE_THRESHOLD,
            )
        except Exception as exc:
            errors.append(f"FaceDetection: {type(exc).__name__}")
            logger.error("MediaPipe face detector could not be loaded (%s)", type(exc).__name__)

        try:
            face_mesh = mp.solutions.face_mesh.FaceMesh(
                static_image_mode=True,
                max_num_faces=1,
                refine_landmarks=False,
                min_detection_confidence=0.5,
            )
        except Exception as exc:
            errors.append(f"FaceMesh: {type(exc).__name__}")
            logger.error("MediaPipe face mesh could not be loaded (%s)", type(exc).__name__)

        MODEL_LOAD_ERROR = "; ".join(errors) or None
        supported_phone_classes = phone_class_ids(MODEL_CLASSES)
        logger.info(
            "AI service startup python=%s mediapipe_detection=%s mediapipe_mesh=%s "
            "opencv=%s numpy=%s phone_model=%s model_path_available=%s "
            "model_classes=%d torch_threads=%d",
            sys.version.split()[0],
            face_detector is not None,
            face_mesh is not None,
            cv2.__version__,
            np.__version__,
            "ready" if yolo is not None and supported_phone_classes else "unavailable",
            bool(MODEL_PATH and os.path.isfile(MODEL_PATH)),
            len(MODEL_CLASSES),
            TORCH_NUM_THREADS,
        )


def close_models() -> None:
    global MODEL_CLASSES, MODEL_LOAD_ERROR, _models_initialized, face_detector, face_mesh, yolo

    for model_name, model in (("face mesh", face_mesh), ("face detector", face_detector)):
        if model is None:
            continue
        try:
            model.close()
        except Exception as exc:
            logger.warning("Could not close the MediaPipe %s (%s)", model_name, type(exc).__name__)
    with _model_initialization_lock:
        face_mesh = None
        face_detector = None
        yolo = None
        MODEL_CLASSES = {}
        MODEL_LOAD_ERROR = None
        _models_initialized = False


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    initialize_models()
    try:
        yield
    finally:
        await asyncio.to_thread(_inference_lock.acquire)
        try:
            close_models()
        finally:
            _inference_lock.release()


app = FastAPI(title="ExamGuard AI service", lifespan=lifespan)

def class_names_by_id(names):
    if isinstance(names, dict):
        return {int(class_id): str(name) for class_id, name in names.items()}
    if isinstance(names, (list, tuple)):
        return {class_id: str(name) for class_id, name in enumerate(names)}
    return {}


def device_kind_for_class(class_name):
    normalized = " ".join(class_name.lower().replace("_", " ").replace("-", " ").split())
    if normalized in {
        "phone",
        "cell phone",
        "cellphone",
        "mobile",
        "mobile phone",
        "smartphone",
        "smart phone",
        "cellular phone",
        "cellular telephone",
        "telephone",
    }:
        return "phone"
    if "tablet" in normalized:
        return "tablet"
    if "laptop" in normalized or "notebook computer" in normalized:
        return "laptop"
    if any(label in normalized for label in ("monitor", "television", "tv", "display", "screen")):
        return "screen"
    return None


def phone_class_ids(names):
    return {
        class_id
        for class_id, name in class_names_by_id(names).items()
        if device_kind_for_class(name) == "phone"
    }


def image_signature_matches(content, content_type):
    signatures = {
        "image/jpeg": content.startswith(b"\xff\xd8\xff"),
        "image/png": content.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": (
            len(content) >= 12
            and content.startswith(b"RIFF")
            and content[8:12] == b"WEBP"
        ),
    }
    if content_type:
        return content_type in signatures and signatures[content_type]
    return any(signatures.values())


def face_box_from_detection(detection, frame_width, frame_height, region_width, region_height, offset_x=0, offset_y=0):
    relative = detection.location_data.relative_bounding_box
    x1 = min(1.0, max(0.0, (offset_x + float(relative.xmin) * region_width) / frame_width))
    y1 = min(1.0, max(0.0, (offset_y + float(relative.ymin) * region_height) / frame_height))
    x2 = min(1.0, max(x1, (offset_x + float(relative.xmin + relative.width) * region_width) / frame_width))
    y2 = min(1.0, max(y1, (offset_y + float(relative.ymin + relative.height) * region_height) / frame_height))
    return {
        "x": x1,
        "y": y1,
        "width": x2 - x1,
        "height": y2 - y1,
        "confidence": float(detection.score[0]) if detection.score else None,
    }


def face_box_iou(first, second):
    x1 = max(first["x"], second["x"])
    y1 = max(first["y"], second["y"])
    x2 = min(first["x"] + first["width"], second["x"] + second["width"])
    y2 = min(first["y"] + first["height"], second["y"] + second["height"])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = first["width"] * first["height"] + second["width"] * second["height"] - intersection
    return intersection / union if union > 0 else 0.0


def merge_face_boxes(face_boxes, overlap_threshold=0.35):
    merged = []
    for box in sorted(face_boxes, key=lambda item: item["confidence"] or 0.0, reverse=True):
        if all(face_box_iou(box, kept) <= overlap_threshold for kept in merged):
            merged.append(box)
    return merged


def face_detection_regions(width, height):
    grid_size = 3
    overlap = 0.1
    tile_width = min(width, int(np.ceil(width / (grid_size - (grid_size - 1) * overlap))))
    tile_height = min(height, int(np.ceil(height / (grid_size - (grid_size - 1) * overlap))))
    if tile_width < 32 or tile_height < 32:
        return []

    x_offsets = [round(index * (width - tile_width) / (grid_size - 1)) for index in range(grid_size)]
    y_offsets = [round(index * (height - tile_height) / (grid_size - 1)) for index in range(grid_size)]
    return [
        (x, y, tile_width, tile_height)
        for y in y_offsets
        for x in x_offsets
    ]


def detect_face_boxes(image, detector, frame_width=None, frame_height=None, offset_x=0, offset_y=0):
    height, width = image.shape[:2]
    frame_width = frame_width or width
    frame_height = frame_height or height
    result = detector.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
    return [
        face_box_from_detection(
            detection,
            frame_width,
            frame_height,
            width,
            height,
            offset_x,
            offset_y,
        )
        for detection in (result.detections or [])
    ]


def detect_face_boxes_with_tiles(image, detector):
    height, width = image.shape[:2]
    face_boxes = detect_face_boxes(image, detector)
    if len(face_boxes) < 2:
        return face_boxes

    for x, y, tile_width, tile_height in face_detection_regions(width, height):
        tile = image[y:y + tile_height, x:x + tile_width]
        face_boxes.extend(
            detect_face_boxes(tile, detector, width, height, x, y)
        )
    return merge_face_boxes(face_boxes)


@app.get("/health")
def health():
    supported_phone_classes = phone_class_ids(MODEL_CLASSES)
    return {
        "python_version": sys.version.split()[0],
        "dependencies": {
            "opencv": cv2.__version__,
            "mediapipe": getattr(mp, "__version__", "unknown"),
            "numpy": np.__version__,
            "fastapi": "ready"
        },
        "mediapipe": "ready" if face_detector is not None else "unavailable",
        "phone_model": "ready" if yolo is not None and supported_phone_classes else "unavailable",
        "phone_model_device": YOLO_DEVICE if yolo is not None else "unavailable",
        "model_path_available": bool(MODEL_PATH and os.path.isfile(MODEL_PATH)),
        "model_load_error": MODEL_LOAD_ERROR,
        "phone_classes": [MODEL_CLASSES[class_id] for class_id in sorted(supported_phone_classes)],
        "visible_device_classes": sorted({kind for name in MODEL_CLASSES.values() if (kind := device_kind_for_class(str(name))) is not None}),
        "looking_away": "ready" if face_mesh is not None else "unavailable",
        "multiple_faces": "ready" if face_detector is not None else "unavailable",
        "latency_ms": latency_summary_ms(),
        "head_pose_thresholds": {
            "yaw_degrees": YAW_THRESHOLD,
            "pitch_degrees": PITCH_THRESHOLD,
            "margin_degrees": HEAD_POSE_MARGIN
        },
        "confidence_thresholds": {
            "phone": PHONE_CONFIDENCE_THRESHOLD,
            "face": FACE_CONFIDENCE_THRESHOLD
        },
        "note": "Head orientation is an approximate review signal, not proof of misconduct."
    }


@app.get("/health/ready", dependencies=[Depends(require_service_auth)])
def authenticated_health():
    """Backend-only readiness probe; proves both processes share the bearer token."""
    return health()


def head_pose_from_landmarks(image, landmarks):
    height, width = image.shape[:2]
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

    pitch = normalize_pitch_degrees(float(angles[0]))
    yaw = float(angles[1])
    roll = float(angles[2])

    return {
        "pitch_degrees": round(pitch, 2),
        "yaw_degrees": round(yaw, 2),
        "roll_degrees": round(roll, 2)
    }


def estimate_head_pose(image, face_mesh):
    """Estimate head orientation only when one face is unambiguous in the frame."""
    result = face_mesh.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
    if not result.multi_face_landmarks or len(result.multi_face_landmarks) != 1:
        return None
    return head_pose_from_landmarks(image, result.multi_face_landmarks[0].landmark)


def estimate_head_pose_for_face(image, face_box, face_mesh):
    frame_height, frame_width = image.shape[:2]
    center_x = face_box["x"] + face_box["width"] / 2
    center_y = face_box["y"] + face_box["height"] / 2
    left = max(0, int((face_box["x"] - face_box["width"] * 0.1) * frame_width))
    top = max(0, int((face_box["y"] - face_box["height"] * 0.1) * frame_height))
    right = min(frame_width, int((face_box["x"] + face_box["width"] * 1.1) * frame_width))
    bottom = min(frame_height, int((face_box["y"] + face_box["height"] * 1.1) * frame_height))
    crop = image[top:bottom, left:right]
    if crop.size == 0:
        return None

    result = face_mesh.process(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
    faces = result.multi_face_landmarks or []
    if len(faces) != 1:
        return None

    landmarks = faces[0].landmark
    mesh_center_x = sum(landmark.x for landmark in landmarks) / len(landmarks)
    mesh_center_y = sum(landmark.y for landmark in landmarks) / len(landmarks)
    matched_center_x = (left + mesh_center_x * crop.shape[1]) / frame_width
    matched_center_y = (top + mesh_center_y * crop.shape[0]) / frame_height
    if (
        abs(matched_center_x - center_x) > face_box["width"] * 0.35
        or abs(matched_center_y - center_y) > face_box["height"] * 0.35
    ):
        return None

    return head_pose_from_landmarks(crop, landmarks)


def normalize_pitch_degrees(pitch: float) -> float:
    # PnP can express an upright face using an equivalent rotation near 180°.
    if pitch < -90:
        pitch = -180 - pitch
    elif pitch > 90:
        pitch = 180 - pitch
    return pitch


def assess_visual_readability(visible_devices, face_count, face_boxes, head_pose, image_shape, camera_health):
    height, width = image_shape[:2]
    face = face_boxes[0] if face_count == 1 and face_boxes else None
    assessments = []

    for device in visible_devices:
        x1, y1, x2, y2 = device["box"]
        box_width = max(0.0, x2 - x1)
        box_height = max(0.0, y2 - y1)
        screen_center_x = (x1 + x2) / 2
        face_center_x = ((face["x"] + face["width"] / 2) * width) if face else None
        bearing = ((screen_center_x - face_center_x) / width) * 60 if face else None
        text_height = round(box_height * 0.02, 1)
        apparent_height = box_height / max(height, 1)
        distance_band = "near" if apparent_height >= 0.3 else "medium" if apparent_height >= 0.15 else "far"
        visible = camera_health == "ok" and device["confidence"] >= PHONE_CONFIDENCE_THRESHOLD and box_width >= 100 and box_height >= 70
        roughly_in_view = bearing is not None and abs(bearing) <= 25 and abs(head_pose["yaw_degrees"]) <= YAW_THRESHOLD if head_pose else False
        potentially_readable = visible and text_height >= 8 and roughly_in_view
        assessments.append({
            "kind": device["kind"],
            "label": device["label"],
            "confidence": device["confidence"],
            "box": device["box"],
            "visible": visible,
            "estimated_distance_band": distance_band,
            "screen_bearing_from_face_degrees": round(bearing, 1) if bearing is not None else None,
            "view_alignment": "roughly_aligned" if roughly_in_view else "unavailable" if face is None or head_pose is None else "not_indicated",
            "estimated_text_height_px": text_height,
            "potentially_readable": potentially_readable,
        })

    return {
        "status": "potentially_readable" if any(item["potentially_readable"] for item in assessments) else "not_indicated",
        "confidence": "low",
        "basis": "YOLO object confidence, apparent screen pixel size, and rough face-relative camera bearing; no OCR or physical distance measurement.",
        "devices": assessments,
        "limitations": "This is an approximate visual review signal, not proof that text was present, readable, or used. Screen viewing angle and physical distance cannot be measured reliably from this single uncalibrated frame.",
    }


def classify_looking_away(head_pose):
    if head_pose is None:
        return "unavailable"
    turned_sideways = abs(head_pose["yaw_degrees"]) > YAW_THRESHOLD + HEAD_POSE_MARGIN
    tilted_up_or_down = abs(head_pose["pitch_degrees"]) > PITCH_THRESHOLD + HEAD_POSE_MARGIN
    return "looking_away" if turned_sideways or tilted_up_or_down else "looking_forward"


def latency_summary_ms(latencies_ms=None):
    """Summarize recent inference latency using median and nearest-rank tails.

    P50 is the conventional median and is shown after one sample. P95 uses
    nearest-rank and is shown after 20 samples; P99 uses nearest-rank and is
    shown after 100 samples. A snapshot of shared history is copied under lock,
    while sorting and percentile calculations happen outside the lock.
    """
    if latencies_ms is None:
        with _latency_history_lock:
            snapshot = tuple(RECENT_INFERENCE_LATENCIES_MS)
    else:
        snapshot = tuple(latencies_ms)
    values = sorted(float(value) for value in snapshot)
    if not values:
        return {
            "p50_ms": 0.0,
            "p95_ms": None,
            "p99_ms": None,
            "count": 0,
            "percentile_method": {
                "p50": "median",
                "p95": "nearest_rank",
                "p99": "nearest_rank",
            },
            "minimum_samples": {"p50": 1, "p95": 20, "p99": 100},
        }

    def percentile(percent):
        rank = ceil((percent / 100.0) * len(values)) - 1
        return values[min(len(values) - 1, max(0, rank))]

    return {
        "p50_ms": round((values[(len(values) - 1) // 2] + values[len(values) // 2]) / 2, 2),
        "p95_ms": round(percentile(95), 2) if len(values) >= 20 else None,
        "p99_ms": round(percentile(99), 2) if len(values) >= 100 else None,
        "count": len(values),
        "percentile_method": {
            "p50": "median",
            "p95": "nearest_rank",
            "p99": "nearest_rank",
        },
        "minimum_samples": {"p50": 1, "p95": 20, "p99": 100},
    }


def record_inference_latency(latency_ms):
    with _latency_history_lock:
        RECENT_INFERENCE_LATENCIES_MS.append(float(latency_ms))


def resize_for_inference(image):
    original_height, original_width = image.shape[:2]
    largest_side = max(original_width, original_height)
    if largest_side <= MAX_INFERENCE_SIDE:
        return image, original_width, original_height

    scale = MAX_INFERENCE_SIDE / largest_side
    resized_width = max(1, round(original_width * scale))
    resized_height = max(1, round(original_height * scale))
    resized = cv2.resize(
        image,
        (resized_width, resized_height),
        interpolation=cv2.INTER_AREA,
    )
    return resized, original_width, original_height


def frame_quality_statistics(image):
    channel_means, channel_stddevs = cv2.meanStdDev(image)
    means = channel_means[:, 0]
    standard_deviations = channel_stddevs[:, 0]
    mean = float(np.mean(means))
    variance = float(np.mean(standard_deviations ** 2 + (means - mean) ** 2))
    return mean, variance ** 0.5


def _analyze_content(content: bytes, content_type: str | None):
    started_at = time.perf_counter()
    inference_stages_ms = {}
    if content_type and content_type not in SUPPORTED_IMAGE_TYPES:
        raise HTTPException(415, "Upload an image file")

    if not content:
        raise HTTPException(400, "Uploaded image is empty")

    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image exceeds the 5 MB limit")

    if not image_signature_matches(content, content_type):
        raise HTTPException(415, "Image content does not match a supported JPEG, PNG, or WebP format")

    stage_started_at = time.perf_counter()
    try:
        image = cv2.imdecode(
            np.frombuffer(content, dtype=np.uint8),
            cv2.IMREAD_COLOR
        )
    except cv2.error as exc:
        logger.info("Rejected an image that OpenCV could not decode (%s)", type(exc).__name__)
        image = None

    inference_stages_ms["image_decode_ms"] = (time.perf_counter() - stage_started_at) * 1000
    if image is None or image.ndim != 3 or image.shape[2] != 3:
        raise HTTPException(400, "Invalid image")
    height, width = image.shape[:2]
    if height < 32 or width < 32 or height * width > MAX_IMAGE_PIXELS:
        raise HTTPException(422, "Image dimensions must be at least 32x32 and no larger than 40 megapixels")

    stage_started_at = time.perf_counter()
    image, original_width, original_height = resize_for_inference(image)
    inference_stages_ms["resize_ms"] = (time.perf_counter() - stage_started_at) * 1000
    height, width = image.shape[:2]
    scale_x = original_width / width
    scale_y = original_height / height

    # Detect and count faces.
    if face_detector is None:
        raise HTTPException(503, "Face-detection model is unavailable")
    stage_started_at = time.perf_counter()
    try:
        face_boxes = detect_face_boxes_with_tiles(image, face_detector)
    except Exception as exc:
        logger.error("Face-detection inference failed (%s)", type(exc).__name__)
        raise HTTPException(503, "Face-detection inference is unavailable") from exc
    inference_stages_ms["face_detection_ms"] = (time.perf_counter() - stage_started_at) * 1000

    face_count = len(face_boxes)
    if face_count > MAX_SUPPORTED_FACE_COUNT:
        raise HTTPException(
            422,
            detail={
                "code": "face_count_limit_exceeded",
                "detected_face_count": face_count,
                "max_face_count": MAX_SUPPORTED_FACE_COUNT,
                "message": (
                    f"Frame contains {face_count} detected faces, exceeding the "
                    f"supported maximum of {MAX_SUPPORTED_FACE_COUNT}; no "
                    "detections were truncated."
                ),
            },
        )
    multiple_faces = face_count > 1
    face_boxes = [
        {
            **box,
            "x": round(box["x"], 4),
            "y": round(box["y"], 4),
            "width": round(box["width"], 4),
            "height": round(box["height"], 4),
            "confidence": round(box["confidence"], 3) if box["confidence"] is not None else None,
        }
        for box in face_boxes
    ]

    # Keep the aggregate signal unavailable for multiple people; per-box poses
    # are diagnostic only and are not attributed to the candidate.
    head_pose = None
    looking_away = "unavailable"
    face_pose_estimates = []
    stage_started_at = time.perf_counter()
    if face_count:
        if face_mesh is None:
            raise HTTPException(503, "Head-pose model is unavailable")
        for index, face_box in enumerate(face_boxes):
            try:
                pose = (
                    estimate_head_pose(image, face_mesh)
                    if face_count == 1
                    else estimate_head_pose_for_face(image, face_box, face_mesh)
                )
            except Exception as exc:
                logger.error(
                    "Head-pose inference failed for detected face %d (%s)",
                    index + 1,
                    type(exc).__name__,
                )
                raise HTTPException(503, "Head-pose inference is unavailable") from exc
            face_pose_estimates.append({
                "face_box": face_box,
                "head_pose": pose,
                "looking_away": classify_looking_away(pose),
            })
            if face_count == 1:
                head_pose = pose

        if face_count == 1:
            looking_away = classify_looking_away(head_pose)
    inference_stages_ms["head_pose_ms"] = (time.perf_counter() - stage_started_at) * 1000

    # Run YOLO phone detection if a compatible model is configured.
    stage_started_at = time.perf_counter()
    phone_detection = "unavailable"
    phone_confidence = None
    phone_boxes = []
    visible_devices = []
    phone_model_ready = False

    if yolo is not None:
        try:
            predictions = yolo.predict(
                source=image,
                conf=PHONE_CONFIDENCE_THRESHOLD,
                device=YOLO_DEVICE,
                verbose=False
            )
        except Exception as exc:
            logger.error("Phone-detection inference failed (%s)", type(exc).__name__)
            raise HTTPException(
                503,
                "Phone-detection model inference is unavailable"
            ) from exc

        if not predictions:
            logger.error("Phone-detection model returned no prediction result")
            raise HTTPException(503, "Phone-detection model returned no result")

        names = predictions[0].names
        names_by_id = class_names_by_id(names)
        boxes = predictions[0].boxes
        supported_phone_classes = phone_class_ids(names_by_id)
        phone_model_ready = bool(supported_phone_classes)
        phone_scores = []

        if supported_phone_classes and boxes is not None:
            for box in boxes:
                class_id = int(box.cls.item())
                class_name = names_by_id.get(class_id)
                if class_name is None:
                    continue
                device_kind = device_kind_for_class(class_name)

                confidence = float(box.conf.item())
                coordinates = box.xyxy[0].tolist()
                coordinates = [
                    float(coordinates[0]) * scale_x,
                    float(coordinates[1]) * scale_y,
                    float(coordinates[2]) * scale_x,
                    float(coordinates[3]) * scale_y,
                ]
                if device_kind and confidence >= PHONE_CONFIDENCE_THRESHOLD:
                    if len(visible_devices) < 30:
                        visible_devices.append({
                            "kind": device_kind,
                            "label": class_name,
                            "confidence": round(confidence, 3),
                            "box": [round(value, 2) for value in coordinates],
                        })
                if class_id in supported_phone_classes and confidence >= PHONE_CONFIDENCE_THRESHOLD:
                    phone_scores.append(confidence)
                    phone_boxes.append({
                        "x1": round(coordinates[0], 2),
                        "y1": round(coordinates[1], 2),
                        "x2": round(coordinates[2], 2),
                        "y2": round(coordinates[3], 2),
                        "confidence": round(confidence, 3),
                        "label": class_name
                    })

        if supported_phone_classes:
            phone_detection = "detected" if phone_scores else "not_detected"
            if phone_scores:
                phone_confidence = round(max(phone_scores), 3)

    inference_stages_ms["phone_detection_ms"] = (time.perf_counter() - stage_started_at) * 1000

    stage_started_at = time.perf_counter()
    frame_mean, frame_stddev = frame_quality_statistics(image)
    obstruction = frame_stddev < 8 or frame_mean < 8
    camera_health = "obstructed" if obstruction else "ok"
    readability = assess_visual_readability(
        visible_devices,
        face_count,
        face_boxes,
        head_pose,
        (original_height, original_width, 3),
        camera_health,
    )
    inference_stages_ms["postprocessing_ms"] = (time.perf_counter() - stage_started_at) * 1000
    total_inference_ms = (time.perf_counter() - started_at) * 1000
    inference_stages_ms["total_ms"] = total_inference_ms
    record_inference_latency(total_inference_ms)

    return {
        "face_presence": face_count > 0,
        "face_count": face_count,
        "face_boxes": face_boxes,
        "multiple_faces": multiple_faces,
        "looking_away": looking_away,
        "head_pose": head_pose,
        "face_pose_estimates": face_pose_estimates,
        "phone_detection": phone_detection,
        "phone_confidence": phone_confidence,
        "phone_boxes": phone_boxes[:20],
        "camera_health": camera_health,
        "visible_devices": visible_devices,
        "readability_assessment": readability,
        "frame_quality": {
            "mean_luminance": round(frame_mean, 2),
            "luminance_stddev": round(frame_stddev, 2)
        },
        "inference_ms": round(total_inference_ms, 2),
        "latency_summary_ms": latency_summary_ms(),
        "inference_stages_ms": {
            stage: round(duration, 2)
            for stage, duration in inference_stages_ms.items()
        },
        "service_version": "examguard-ai-local-v1",
        "phone_model": "configured" if phone_model_ready else "unavailable",
        "disclosure": (
            "One uploaded frame was processed in memory. "
            "This endpoint does not save images or create incidents. "
            "Head orientation is an approximate signal, not eye-gaze tracking."
        )
    }


def release_inference_slot(future: asyncio.Future) -> None:
    try:
        if not future.cancelled():
            error = future.exception()
            if error is not None and not isinstance(error, HTTPException):
                logger.error("AI inference worker failed (%s)", type(error).__name__)
    finally:
        if _inference_lock.locked():
            _inference_lock.release()


@app.post("/analyze", dependencies=[Depends(require_service_auth)])
async def analyze(frame: UploadFile):
    global _last_inference_started_at

    if frame.content_type and frame.content_type not in SUPPORTED_IMAGE_TYPES:
        raise HTTPException(415, "Upload an image file")
    if not _inference_lock.acquire(blocking=False):
        raise HTTPException(
            503,
            "AI inference is busy; retry after the current frame completes",
            headers={"Retry-After": "1"},
        )

    inference_running_in_worker = False
    try:
        now = time.monotonic()
        with _throttle_lock:
            elapsed = now - _last_inference_started_at
            retry_after = INFERENCE_MIN_INTERVAL_SECONDS - elapsed
            if retry_after > 0:
                raise HTTPException(
                    429,
                    "AI inference is being throttled",
                    headers={"Retry-After": str(max(1, ceil(retry_after)))},
                )
            _last_inference_started_at = now

        content = await frame.read(MAX_IMAGE_BYTES + 1)
        loop = asyncio.get_running_loop()
        inference = loop.run_in_executor(None, _analyze_content, content, frame.content_type)
        inference.add_done_callback(release_inference_slot)
        inference_running_in_worker = True
        try:
            return await asyncio.wait_for(
                asyncio.shield(inference),
                timeout=INFERENCE_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError as exc:
            logger.warning("AI inference exceeded the %.2f-second timeout", INFERENCE_TIMEOUT_SECONDS)
            raise HTTPException(504, "AI inference timed out") from exc
    finally:
        try:
            await frame.close()
        finally:
            if not inference_running_in_worker:
                _inference_lock.release()
