# AI proctoring service

Install the service boundary in an isolated Python environment:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn main:app --port 8000
```

This starts the health endpoint at `http://localhost:8000/health`. It reports
computer-vision capabilities as unavailable unless they are installed. On a
host that is approved to process disclosed frames, install the optional stack
with `python -m pip install -r requirements-ai.txt`; configure
`YOLO_MODEL_PATH` only with a validated model.

MediaPipe supports face landmarks for face presence, multiple faces, and approximate head-pose calculations. Phone detection is optional and requires a compatible YOLO model specified by `YOLO_MODEL_PATH`; the health endpoint reports it as unavailable otherwise. The supplied endpoint intentionally does not claim completed detections until the production model pipeline is enabled and validated.

Do not send continuous video. Send only disclosed, sampled frames needed for a configured review signal. This service stores no frames; private evidence retention must be explicit and handled by the API/storage layer.
