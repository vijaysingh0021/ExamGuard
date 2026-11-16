# AI proctoring service

Install the service in a Python environment using the pinned dependencies:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn main:app --host 127.0.0.1 --port 8001
```

This starts the health endpoint at `http://localhost:8001/health`. It reports
computer-vision capabilities and model availability. The requirements file
includes the FastAPI, MediaPipe, OpenCV, and Ultralytics runtime. Configure
`YOLO_MODEL_PATH` to an existing, validated YOLO weights file; without
compatible weights, phone detection reports unavailable and authenticated
monitoring readiness fails closed.

MediaPipe supports face landmarks for face presence, multiple faces, and approximate head-pose calculations. Phone detection is optional and requires a compatible YOLO model specified by `YOLO_MODEL_PATH`. The model must expose a recognized phone class label (for example, `cell phone`, `mobile phone`, or `smartphone`); a loaded model without one reports phone detection as unavailable rather than reporting false negatives. The authenticated readiness endpoint requires this phone capability as well as MediaPipe.

Do not send continuous video. Send only disclosed, sampled frames needed for a configured review signal. This service stores no frames; private evidence retention must be explicit and handled by the API/storage layer.

## Constrained-instance settings

The service loads YOLO, MediaPipe face detection, and face mesh once during
application startup and waits for active inference before closing MediaPipe
models at shutdown. `/health` reports model availability without running
inference; the authenticated `/health/ready` reports each required capability
so the backend can fail closed when a model is unavailable.

The Docker defaults are intended to bound concurrent work on small CPU
instances while preserving the original response fields:

- `AI_MAX_INFERENCE_SIDE=960` caps the longest processed image edge and keeps
  aspect ratio. Returned pixel-coordinate device boxes are scaled back to the
  uploaded image dimensions.
- `AI_INFERENCE_MIN_INTERVAL_SECONDS=1` throttles rapid requests; an inference
  already running is never overlapped.
- `AI_INFERENCE_TIMEOUT_SECONDS=10` returns an explicit timeout response while
  allowing the current worker to finish before accepting another inference.
- `AI_TORCH_THREADS=1` and the OpenMP/BLAS thread settings prevent CPU
  oversubscription. Uvicorn runs a single worker to avoid duplicate model sets.

Override these environment variables only after validating latency, memory,
and detection behavior on the target instance. The input byte and pixel limits,
authentication, and private evidence handling are unchanged.

Face detection uses MediaPipe's long-range model (`model_selection=1`).
On the checked group sample it detected eight faces; the short-range model
detected none. It also detected the single face in `camera_test.jpg`. When a
full-frame pass finds multiple faces, the service refines detections across
nine overlapping tiles using the same confidence threshold, then merges
overlapping boxes. This improves the checked collage result from 11 to 12
faces without changing the eight-face group or one-face camera sample.

Head-pose estimates for multiple faces are returned in `face_pose_estimates`,
each paired with its frame-local `face_box`. The aggregate `looking_away`
remains `unavailable` when multiple faces are present, so an observation about
one visible person is not attributed to the candidate. These box associations
are per-frame only; the service does not maintain identity or tracks across
frames, and the backend does not qualify a multi-face pose as a candidate
looking-away event. Head orientation is approximate and is not eye-gaze
tracking.

## Validation images

Real-model image tests are separate from mocked unit tests. Use only images
you are authorized to process, and keep test images local. The repository's
`camera_test.jpg` is a consented one-face sample; it contains no visible phone
and is only suitable for one-face/phone-negative checks. The local positive
samples currently used for validation are Pexels photos under the
[Pexels license](https://www.pexels.com/license/): [phone photo 1283371](https://www.pexels.com/photo/man-holding-iphone-1283371/)
and [group photo 3184393](https://www.pexels.com/photo/photo-of-people-standing-near-blackboard-3184393/).
They are ignored by Git and used only for local inference checks, not candidate
decisions. A site photo license is not evidence that these images represent a
candidate or authorize exam monitoring. To supply different local samples:

```powershell
python .\prepare_test_images.py --phone-image C:\path\to\authorized-phone.jpg --faces-image C:\path\to\authorized-multiple-faces.jpg
```

The script validates that both source files are readable JPEG, PNG, or WebP
images, converts them to JPEG, checks dimensions, and refuses to overwrite an
existing non-empty test asset. The zero-byte `test-phone.jpg` placeholder can
only be replaced with the explicit `--replace-empty-placeholder` option.
Images are local test data and must not be committed.

Run unit and preparation tests separately from real-model tests:

```powershell
python -m unittest -v test_inference test_auth test_prepare_test_images
python -m unittest -v test_real_model_inference
```

Real-model tests skip with a reason when the model or a sample is unavailable.
The real tests include a synthetic no-face/no-phone frame and the consented
one-face camera sample. Far-phone, partially occluded phone, many-face, and
looking-away validation require the corresponding local images; skipped tests
are not successful detection results.

When using an external virtual environment, point the root startup script at
its Python executable before `npm run dev`, or set `AI_SERVICE_PYTHON` in the
root `.env`:

```powershell
$env:AI_SERVICE_PYTHON = 'D:\ExamGuard-AI\.venv\Scripts\python.exe'
npm run dev
```
