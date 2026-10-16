# AI proctoring service

Install in an isolated Python environment: `pip install -r requirements.txt`, then run `uvicorn main:app --port 8000`.

MediaPipe supports face landmarks for face presence, multiple faces, and approximate head-pose calculations. Phone detection is optional and requires a compatible YOLO model specified by `YOLO_MODEL_PATH`; the health endpoint reports it as unavailable otherwise. The supplied endpoint intentionally does not claim completed detections until the production model pipeline is enabled and validated.

Do not send continuous video. Send only disclosed, sampled frames needed for a configured review signal. This service stores no frames; private evidence retention must be explicit and handled by the API/storage layer.
