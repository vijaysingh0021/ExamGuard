import asyncio
from io import BytesIO
import os
import sys
from types import SimpleNamespace
import threading
import time
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from fastapi import HTTPException
from starlette.datastructures import Headers, UploadFile

import main
from main import (
    assess_visual_readability,
    class_names_by_id,
    device_kind_for_class,
    normalize_pitch_degrees,
    phone_class_ids,
)


class FakeValue:
    def __init__(self, value):
        self.value = value

    def item(self):
        return self.value


class FakeCoordinates:
    def tolist(self):
        return [120.0, 100.0, 260.0, 320.0]


class FakeYolo:
    def __init__(self, class_name):
        self.names = {0: class_name}
        self.source_shape = None
        self.device = None

    def predict(self, **kwargs):
        self.source_shape = kwargs["source"].shape[:2]
        self.device = kwargs.get("device")
        box = SimpleNamespace(
            cls=FakeValue(0),
            conf=FakeValue(0.91),
            xyxy=[FakeCoordinates()],
        )
        return [SimpleNamespace(names=self.names, boxes=[box])]


def make_test_frame():
    image = np.zeros((480, 640, 3), dtype=np.uint8)
    image[:, :, 0] = np.tile(np.arange(640, dtype=np.uint8), (480, 1))
    success, encoded = cv2.imencode(".jpg", image)
    if not success:
        raise AssertionError("Could not encode the inference test frame")
    return UploadFile(
        filename="inference.jpg",
        file=BytesIO(encoded.tobytes()),
        headers=Headers({"content-type": "image/jpeg"}),
    )


def make_upload(content, content_type="image/jpeg", filename="test.jpg"):
    return UploadFile(
        filename=filename,
        file=BytesIO(content),
        headers=Headers({"content-type": content_type}),
    )


def encode_test_image(image):
    success, encoded = cv2.imencode(".jpg", image)
    if not success:
        raise AssertionError("Could not encode the inference test frame")
    return encoded.tobytes()


def make_face_detection(xmin, ymin, width, height, confidence=0.9):
    return SimpleNamespace(
        location_data=SimpleNamespace(
            relative_bounding_box=SimpleNamespace(
                xmin=xmin,
                ymin=ymin,
                width=width,
                height=height,
            )
        ),
        score=[confidence],
    )


class FakeFaceDetector:
    def __init__(self, detections=None, error=None, expected_shape=None):
        self.detections = detections
        self.error = error
        self.expected_shape = expected_shape

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def process(self, image):
        if self.error:
            raise self.error
        if self.expected_shape and image.shape[:2] != self.expected_shape:
            return SimpleNamespace(detections=[])
        return SimpleNamespace(detections=self.detections)

    def close(self):
        pass


class FakeFaceMesh:
    def __init__(self, faces, error=None):
        self.faces = faces
        self.error = error

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def process(self, _image):
        if self.error:
            raise self.error
        return SimpleNamespace(multi_face_landmarks=self.faces)

    def close(self):
        pass


class ModelInitializationTests(unittest.TestCase):
    def setUp(self):
        self.previous_yolo_device = main.YOLO_DEVICE

    def tearDown(self):
        main.YOLO_DEVICE = self.previous_yolo_device

    def test_latency_summary_reports_median_and_tail_percentiles(self):
        summary = main.latency_summary_ms(list(range(1, 101)))

        self.assertEqual(summary["count"], 100)
        self.assertAlmostEqual(summary["p50_ms"], 50.5)
        self.assertEqual(summary["p95_ms"], 95)
        self.assertEqual(summary["p99_ms"], 99)
        self.assertEqual(summary["percentile_method"], {
            "p50": "median",
            "p95": "nearest_rank",
            "p99": "nearest_rank",
        })
        self.assertEqual(summary["minimum_samples"], {"p50": 1, "p95": 20, "p99": 100})

    def test_latency_tail_percentiles_wait_for_minimum_sample_counts(self):
        nineteen_samples = main.latency_summary_ms(list(range(1, 20)))
        twenty_samples = main.latency_summary_ms(list(range(1, 21)))
        ninety_nine_samples = main.latency_summary_ms(list(range(1, 100)))

        self.assertEqual(nineteen_samples["p50_ms"], 10)
        self.assertIsNone(nineteen_samples["p95_ms"])
        self.assertEqual(twenty_samples["p95_ms"], 19)
        self.assertIsNone(ninety_nine_samples["p99_ms"])

    def test_latency_history_updates_and_snapshots_are_thread_safe(self):
        with main._latency_history_lock:
            previous_values = list(main.RECENT_INFERENCE_LATENCIES_MS)
            main.RECENT_INFERENCE_LATENCIES_MS.clear()

        failures = []

        def write_samples():
            try:
                for value in range(1000):
                    main.record_inference_latency(value)
            except Exception as exc:
                failures.append(exc)

        writer = threading.Thread(target=write_samples)
        writer.start()
        try:
            while writer.is_alive():
                summary = main.latency_summary_ms()
                self.assertLessEqual(summary["count"], main.RECENT_INFERENCE_LATENCIES_MS.maxlen)
        finally:
            writer.join()
            with main._latency_history_lock:
                main.RECENT_INFERENCE_LATENCIES_MS.clear()
                main.RECENT_INFERENCE_LATENCIES_MS.extend(previous_values)

        self.assertEqual(failures, [])
        self.assertEqual(main.latency_summary_ms([10, 20, 30])["p50_ms"], 20)

    def test_cuda_is_opt_in_and_cpu_is_used_when_not_requested(self):
        model = self._load_model_with_cuda(enabled=False, available=True)

        self.assertEqual(main.YOLO_DEVICE, "cpu")
        self.assertEqual(model.to_calls, [])

    def test_cuda_request_falls_back_to_cpu_when_unavailable(self):
        model = self._load_model_with_cuda(enabled=True, available=False)

        self.assertEqual(main.YOLO_DEVICE, "cpu")
        self.assertEqual(model.to_calls, [])

    def test_cuda_model_move_failure_restores_cpu(self):
        model = self._load_model_with_cuda(enabled=True, available=True, cuda_error=RuntimeError("no device"))

        self.assertEqual(main.YOLO_DEVICE, "cpu")
        self.assertEqual(model.to_calls, ["cuda", "cpu"])

    def test_cuda_device_is_selected_only_after_successful_model_move(self):
        model = self._load_model_with_cuda(enabled=True, available=True)

        self.assertEqual(main.YOLO_DEVICE, "cuda")
        self.assertEqual(model.to_calls, ["cuda"])

    def _load_model_with_cuda(self, enabled, available, cuda_error=None):
        class FakeModel:
            def __init__(self):
                self.to_calls = []

            def to(self, device):
                self.to_calls.append(device)
                if device == "cuda" and cuda_error:
                    raise cuda_error
                return self

        model = FakeModel()
        torch = SimpleNamespace(
            cuda=SimpleNamespace(is_available=lambda: available),
            backends=SimpleNamespace(cudnn=SimpleNamespace(benchmark=False)),
        )
        ultralytics = SimpleNamespace(YOLO=lambda _path: model)
        with (
            patch.dict(os.environ, {"AI_USE_CUDA": "1" if enabled else "0"}),
            patch.dict(sys.modules, {"torch": torch, "ultralytics": ultralytics}),
        ):
            loaded = main.load_yolo_model("fake-model.pt")
        self.assertIs(loaded, model)
        return model

    def test_initialization_loads_each_model_once_and_closes_mediapipe(self):
        class ClosableModel:
            names = {67: "cell phone"}

            def __init__(self):
                self.close_calls = 0

            def close(self):
                self.close_calls += 1

        yolo_model = ClosableModel()
        detector = ClosableModel()
        mesh = ClosableModel()

        with (
            patch.object(main, "_models_initialized", False),
            patch.object(main, "MODEL_PATH", __file__),
            patch.object(main, "MODEL_CLASSES", {}),
            patch.object(main, "MODEL_LOAD_ERROR", None),
            patch.object(main, "yolo", None),
            patch.object(main, "face_detector", None),
            patch.object(main, "face_mesh", None),
            patch.object(main, "load_yolo_model", return_value=yolo_model) as load_yolo,
            patch.object(main.mp.solutions.face_detection, "FaceDetection", return_value=detector) as load_detector,
            patch.object(main.mp.solutions.face_mesh, "FaceMesh", return_value=mesh) as load_mesh,
        ):
            main.initialize_models()
            main.initialize_models()

            load_yolo.assert_called_once_with(__file__)
            load_detector.assert_called_once()
            load_mesh.assert_called_once()
            self.assertEqual(main.health()["phone_model"], "ready")
            self.assertEqual(main.health()["mediapipe"], "ready")
            self.assertEqual(main.health()["looking_away"], "ready")

            main.close_models()

            self.assertEqual(detector.close_calls, 1)
            self.assertEqual(mesh.close_calls, 1)

    def test_shutdown_waits_for_inference_before_closing_models(self):
        async def exercise_shutdown():
            inference_lock = main._inference_lock
            self.assertTrue(inference_lock.acquire(blocking=False))
            models_closed = threading.Event()
            shutdown_waiting = asyncio.Event()
            original_to_thread = asyncio.to_thread

            async def observed_to_thread(function, *args, **kwargs):
                shutdown_waiting.set()
                return await original_to_thread(function, *args, **kwargs)

            async def run_lifespan():
                async with main.lifespan(main.app):
                    pass

            try:
                with (
                    patch.object(main, "initialize_models"),
                    patch.object(main, "close_models", side_effect=models_closed.set),
                    patch.object(asyncio, "to_thread", new=observed_to_thread),
                ):
                    shutdown = asyncio.create_task(run_lifespan())
                    await shutdown_waiting.wait()
                    self.assertFalse(models_closed.is_set())
                    inference_lock.release()
                    await shutdown
                    self.assertTrue(models_closed.is_set())
            finally:
                if inference_lock.locked():
                    inference_lock.release()

        asyncio.run(exercise_shutdown())


class HeadPoseTests(unittest.TestCase):
    def setUp(self):
        self.previous_runtime = (
            main.yolo,
            main.face_detector,
            main.face_mesh,
            main.INFERENCE_MIN_INTERVAL_SECONDS,
            main._last_inference_started_at,
        )
        main.yolo = None
        main.face_detector = FakeFaceDetector(detections=[])
        main.face_mesh = FakeFaceMesh([])
        main.INFERENCE_MIN_INTERVAL_SECONDS = 0
        main._last_inference_started_at = 0

    def tearDown(self):
        (
            main.yolo,
            main.face_detector,
            main.face_mesh,
            main.INFERENCE_MIN_INTERVAL_SECONDS,
            main._last_inference_started_at,
        ) = self.previous_runtime

    def test_normalizes_equivalent_upright_face_rotation(self):
        self.assertAlmostEqual(normalize_pitch_degrees(-163.44), -16.56)
        self.assertAlmostEqual(normalize_pitch_degrees(163.44), 16.56)

    def test_preserves_pitch_within_the_canonical_range(self):
        self.assertAlmostEqual(normalize_pitch_degrees(-25), -25)
        self.assertAlmostEqual(normalize_pitch_degrees(25), 25)

    def test_head_pose_requires_exactly_one_face_mesh(self):
        with patch.object(main.cv2, "solvePnP") as solve_pnp:
            self.assertIsNone(main.estimate_head_pose(np.zeros((480, 640, 3), dtype=np.uint8), FakeFaceMesh([])))
            two_faces = [SimpleNamespace(landmark=[]), SimpleNamespace(landmark=[])]
            self.assertIsNone(main.estimate_head_pose(np.zeros((480, 640, 3), dtype=np.uint8), FakeFaceMesh(two_faces)))
        solve_pnp.assert_not_called()

    def test_head_pose_uses_solvepnp_angles_and_normalizes_pitch(self):
        landmarks = [SimpleNamespace(x=0.5, y=0.5) for _ in range(292)]
        face_mesh = FakeFaceMesh([SimpleNamespace(landmark=landmarks)])
        with (
            patch.object(main.cv2, "solvePnP", return_value=(True, np.zeros((3, 1)), None)),
            patch.object(main.cv2, "Rodrigues", return_value=(np.eye(3), None)),
            patch.object(main.cv2, "RQDecomp3x3", return_value=((-163.44, 12.5, 3.0),)),
        ):
            result = main.estimate_head_pose(np.zeros((480, 640, 3), dtype=np.uint8), face_mesh)
        self.assertEqual(result, {"pitch_degrees": -16.56, "yaw_degrees": 12.5, "roll_degrees": 3.0})

    def test_analysis_returns_consistent_shape_when_phone_model_is_unavailable(self):
        success, encoded = cv2.imencode(".jpg", np.zeros((480, 640, 3), dtype=np.uint8))
        self.assertTrue(success)
        frame = UploadFile(
            filename="blank.jpg",
            file=BytesIO(encoded.tobytes()),
            headers=Headers({"content-type": "image/jpeg"}),
        )

        with patch.object(main, "yolo", None):
            result = asyncio.run(main.analyze(frame))

        self.assertEqual(result["phone_detection"], "unavailable")
        self.assertEqual(result["phone_model"], "unavailable")
        self.assertEqual(result["phone_boxes"], [])
        self.assertEqual(result["camera_health"], "obstructed")

    def test_large_frame_is_resized_with_boxes_scaled_to_original_pixels(self):
        image = np.zeros((600, 1200, 3), dtype=np.uint8)
        frame = make_upload(encode_test_image(image))
        yolo = FakeYolo("cell phone")

        with (
            patch.object(main, "MAX_INFERENCE_SIDE", 960),
            patch.object(main, "yolo", yolo),
        ):
            result = asyncio.run(main.analyze(frame))

        self.assertEqual(yolo.source_shape, (480, 960))
        self.assertEqual(result["phone_boxes"][0]["x1"], 150.0)
        self.assertEqual(result["phone_boxes"][0]["y1"], 125.0)
        self.assertEqual(result["phone_boxes"][0]["x2"], 325.0)
        self.assertEqual(result["phone_boxes"][0]["y2"], 400.0)

    def test_synthetic_no_face_image_reports_no_face_without_head_pose(self):
        image = np.zeros((480, 640, 3), dtype=np.uint8)
        frame = make_upload(encode_test_image(image))

        with patch.object(main, "yolo", None):
            result = asyncio.run(main.analyze(frame))

        self.assertEqual(result["face_count"], 0)
        self.assertFalse(result["multiple_faces"])
        self.assertEqual(result["face_boxes"], [])
        self.assertIsNone(result["head_pose"])
        self.assertEqual(result["looking_away"], "unavailable")

    def test_multiple_faces_disable_ambiguous_head_pose(self):
        detections = [
            make_face_detection(0.1, 0.2, 0.2, 0.3),
            make_face_detection(0.6, 0.2, 0.2, 0.3),
        ]
        frame = make_test_frame()

        with (
            patch.object(
                main,
                "face_detector",
                FakeFaceDetector(detections, expected_shape=(480, 640)),
            ),
            patch.object(main, "face_mesh", FakeFaceMesh([])),
            patch.object(
                main,
                "estimate_head_pose_for_face",
                side_effect=[
                    {"pitch_degrees": 0.0, "yaw_degrees": 42.0, "roll_degrees": 0.0},
                    {"pitch_degrees": 0.0, "yaw_degrees": 0.0, "roll_degrees": 0.0},
                ],
            ),
            patch.object(main, "yolo", None),
        ):
            result = asyncio.run(main.analyze(frame))

        self.assertEqual(result["face_count"], 2)
        self.assertTrue(result["multiple_faces"])
        self.assertEqual(len(result["face_boxes"]), 2)
        self.assertIsNone(result["head_pose"])
        self.assertEqual(result["looking_away"], "unavailable")
        self.assertEqual(
            [estimate["looking_away"] for estimate in result["face_pose_estimates"]],
            ["looking_away", "looking_forward"],
        )
        for box in result["face_boxes"]:
            self.assertGreaterEqual(box["x"], 0)
            self.assertGreaterEqual(box["y"], 0)
            self.assertLessEqual(box["x"] + box["width"], 1)
            self.assertLessEqual(box["y"] + box["height"], 1)

    def test_exactly_twenty_faces_are_supported_without_truncation(self):
        boxes = [
            {
                "x": (index % 5) * 0.18,
                "y": (index // 5) * 0.18,
                "width": 0.15,
                "height": 0.15,
                "confidence": 0.9,
            }
            for index in range(20)
        ]
        pose = {"pitch_degrees": 0.0, "yaw_degrees": 0.0, "roll_degrees": 0.0}

        with (
            patch.object(main, "face_detector", FakeFaceDetector([])),
            patch.object(main, "face_mesh", FakeFaceMesh([])),
            patch.object(main, "yolo", None),
            patch.object(main, "detect_face_boxes_with_tiles", return_value=boxes),
            patch.object(main, "estimate_head_pose_for_face", return_value=pose) as estimate_pose,
        ):
            result = main._analyze_content(
                encode_test_image(np.zeros((480, 640, 3), dtype=np.uint8)),
                "image/jpeg",
            )

        self.assertEqual(main.MAX_SUPPORTED_FACE_COUNT, 20)
        self.assertEqual(result["face_count"], 20)
        self.assertEqual(len(result["face_boxes"]), 20)
        self.assertEqual(len(result["face_pose_estimates"]), 20)
        self.assertTrue(result["multiple_faces"])
        self.assertEqual(result["looking_away"], "unavailable")
        self.assertEqual(estimate_pose.call_count, 20)

    def test_excess_faces_return_structured_422_without_truncation(self):
        boxes = [
            {
                "x": (index % 5) * 0.18,
                "y": (index // 5) * 0.18,
                "width": 0.15,
                "height": 0.15,
                "confidence": 0.9,
            }
            for index in range(main.MAX_SUPPORTED_FACE_COUNT + 1)
        ]

        with (
            patch.object(main, "face_detector", FakeFaceDetector([])),
            patch.object(main, "face_mesh", FakeFaceMesh([])),
            patch.object(main, "yolo", None),
            patch.object(main, "detect_face_boxes_with_tiles", return_value=boxes),
            patch.object(main, "estimate_head_pose_for_face") as estimate_pose,
        ):
            with self.assertRaises(HTTPException) as raised:
                main._analyze_content(
                    encode_test_image(np.zeros((480, 640, 3), dtype=np.uint8)),
                    "image/jpeg",
                )

        self.assertEqual(raised.exception.status_code, 422)
        self.assertEqual(raised.exception.detail, {
            "code": "face_count_limit_exceeded",
            "detected_face_count": 21,
            "max_face_count": 20,
            "message": "Frame contains 21 detected faces, exceeding the supported maximum of 20; no detections were truncated.",
        })
        estimate_pose.assert_not_called()

    def test_face_boxes_from_overlapping_tiles_are_deduplicated_by_overlap(self):
        boxes = [
            {"x": 0.10, "y": 0.20, "width": 0.20, "height": 0.30, "confidence": 0.8},
            {"x": 0.11, "y": 0.21, "width": 0.20, "height": 0.30, "confidence": 0.9},
            {"x": 0.61, "y": 0.20, "width": 0.20, "height": 0.30, "confidence": 0.85},
        ]

        merged = main.merge_face_boxes(boxes)

        self.assertEqual(len(merged), 2)
        self.assertEqual(merged[0]["confidence"], 0.9)
        self.assertEqual(merged[1]["x"], 0.61)

    def test_face_detection_tiles_overlap_and_stay_inside_the_frame(self):
        regions = main.face_detection_regions(1152, 768)

        self.assertEqual(len(regions), 9)
        for x, y, width, height in regions:
            self.assertGreaterEqual(x, 0)
            self.assertGreaterEqual(y, 0)
            self.assertLessEqual(x + width, 1152)
            self.assertLessEqual(y + height, 768)


class FaceAndFrameInferenceTests(unittest.TestCase):
    def setUp(self):
        self.previous_runtime = (
            main.yolo,
            main.face_detector,
            main.face_mesh,
            main.INFERENCE_MIN_INTERVAL_SECONDS,
            main._last_inference_started_at,
        )
        main.yolo = None
        main.face_detector = FakeFaceDetector(detections=[])
        main.face_mesh = FakeFaceMesh([])
        main.INFERENCE_MIN_INTERVAL_SECONDS = 0
        main._last_inference_started_at = 0

    def tearDown(self):
        (
            main.yolo,
            main.face_detector,
            main.face_mesh,
            main.INFERENCE_MIN_INTERVAL_SECONDS,
            main._last_inference_started_at,
        ) = self.previous_runtime

    @staticmethod
    def make_scene(level=80):
        image = np.full((480, 640, 3), level, dtype=np.uint8)
        image[:, :, 0] = np.tile(np.arange(640, dtype=np.uint8), (480, 1))
        return image

    @staticmethod
    def make_box(x=0.2):
        return {"x": x, "y": 0.2, "width": 0.2, "height": 0.3, "confidence": 0.9}

    def analyze_sequence(self, images, detections_by_frame, poses, delay_between_frames=0.0):
        detection_calls = []
        pose_values = iter(poses)

        def detect(_image, _detector):
            detection_calls.append(1)
            return detections_by_frame[len(detection_calls) - 1]

        def estimate_pose(*_args):
            return next(pose_values)

        with (
            patch.object(main, "face_detector", object()),
            patch.object(main, "face_mesh", object()),
            patch.object(main, "yolo", None),
            patch.object(main, "detect_face_boxes_with_tiles", side_effect=detect),
            patch.object(main, "estimate_head_pose", side_effect=estimate_pose),
            patch.object(main, "estimate_head_pose_for_face", side_effect=estimate_pose),
        ):
            results = []
            for index, image in enumerate(images):
                if index and delay_between_frames:
                    time.sleep(delay_between_frames)
                results.append(main._analyze_content(encode_test_image(image), "image/jpeg"))
        return results, detection_calls

    def test_head_movement_and_looking_away_are_recomputed_for_each_frame(self):
        image = self.make_scene()
        forward = {"yaw_degrees": 0.0, "pitch_degrees": 0.0, "roll_degrees": 0.0}
        turned = {"yaw_degrees": 42.0, "pitch_degrees": 0.0, "roll_degrees": 0.0}

        results, calls = self.analyze_sequence(
            [image, image],
            [[self.make_box()], [self.make_box()]],
            [forward, turned],
        )

        self.assertEqual(len(calls), 2)
        self.assertEqual(results[0]["looking_away"], "looking_forward")
        self.assertEqual(results[1]["looking_away"], "looking_away")
        self.assertEqual(results[1]["head_pose"], turned)

    def test_second_person_entering_invalidates_any_prior_single_face_state(self):
        image = self.make_scene()
        pose = {"yaw_degrees": 0.0, "pitch_degrees": 0.0, "roll_degrees": 0.0}
        results, calls = self.analyze_sequence(
            [image, image],
            [[self.make_box()], [self.make_box(), self.make_box(0.6)]],
            [pose, pose, pose],
        )

        self.assertEqual(len(calls), 2)
        self.assertEqual(results[0]["face_count"], 1)
        self.assertEqual(results[1]["face_count"], 2)
        self.assertTrue(results[1]["multiple_faces"])
        self.assertEqual(results[1]["looking_away"], "unavailable")

    def test_second_person_leaving_recomputes_candidate_pose(self):
        image = self.make_scene()
        pose = {"yaw_degrees": 0.0, "pitch_degrees": 0.0, "roll_degrees": 0.0}
        results, calls = self.analyze_sequence(
            [image, image],
            [[self.make_box(), self.make_box(0.6)], [self.make_box()]],
            [pose, pose, pose],
        )

        self.assertEqual(len(calls), 2)
        self.assertEqual(results[0]["face_count"], 2)
        self.assertEqual(results[1]["face_count"], 1)
        self.assertEqual(results[1]["looking_away"], "looking_forward")

    def test_small_localized_change_still_runs_face_detection(self):
        first = self.make_scene()
        localized_change = first.copy()
        localized_change[205:210, 205:210] = 255
        results, calls = self.analyze_sequence(
            [first, localized_change],
            [[], [self.make_box()]],
            [{"yaw_degrees": 0.0, "pitch_degrees": 0.0, "roll_degrees": 0.0}],
        )

        self.assertEqual(len(calls), 2)
        self.assertFalse(results[0]["face_presence"])
        self.assertTrue(results[1]["face_presence"])

    def test_camera_movement_still_runs_face_detection(self):
        first = self.make_scene()
        moved = np.roll(first, 24, axis=1)
        results, calls = self.analyze_sequence(
            [first, moved],
            [[self.make_box()], []],
            [{"yaw_degrees": 0.0, "pitch_degrees": 0.0, "roll_degrees": 0.0}],
        )

        self.assertEqual(len(calls), 2)
        self.assertTrue(results[0]["face_presence"])
        self.assertFalse(results[1]["face_presence"])

    def test_lighting_change_still_runs_face_detection(self):
        first = self.make_scene(60)
        brighter = cv2.convertScaleAbs(first, alpha=1.0, beta=70)
        results, calls = self.analyze_sequence(
            [first, brighter],
            [[self.make_box()], []],
            [{"yaw_degrees": 0.0, "pitch_degrees": 0.0, "roll_degrees": 0.0}],
        )

        self.assertEqual(len(calls), 2)
        self.assertNotEqual(
            results[0]["frame_quality"]["mean_luminance"],
            results[1]["frame_quality"]["mean_luminance"],
        )
        self.assertFalse(results[1]["face_presence"])

    def test_identical_frames_are_reprocessed_past_the_former_cache_expiry(self):
        image = self.make_scene()
        results, calls = self.analyze_sequence(
            [image, image],
            [[self.make_box()], []],
            [{"yaw_degrees": 0.0, "pitch_degrees": 0.0, "roll_degrees": 0.0}],
            delay_between_frames=0.76,
        )

        self.assertFalse(hasattr(main, "_FACE_RESULT_CACHE"))
        self.assertEqual(len(calls), 2)
        self.assertTrue(results[0]["face_presence"])
        self.assertFalse(results[1]["face_presence"])

    def test_empty_frame_and_face_disappearance_transitions_are_recomputed(self):
        image = self.make_scene()
        results, calls = self.analyze_sequence(
            [image, image, image, image],
            [[self.make_box()], [], [], [self.make_box()]],
            [
                {"yaw_degrees": 0.0, "pitch_degrees": 0.0, "roll_degrees": 0.0},
                {"yaw_degrees": 0.0, "pitch_degrees": 0.0, "roll_degrees": 0.0},
            ],
        )

        self.assertEqual(len(calls), 4)
        self.assertEqual([result["face_count"] for result in results], [1, 0, 0, 1])
        self.assertEqual(results[1]["looking_away"], "unavailable")
        self.assertEqual(results[3]["looking_away"], "looking_forward")

    def test_face_model_errors_are_reported_as_service_unavailable(self):
        frame = make_test_frame()
        detector = FakeFaceDetector(error=RuntimeError("test inference failure"))
        with patch.object(main, "face_detector", detector):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(main.analyze(frame))
        self.assertEqual(raised.exception.status_code, 503)

    def test_head_pose_model_errors_are_reported_as_service_unavailable(self):
        frame = make_test_frame()
        detector = FakeFaceDetector([make_face_detection(0.2, 0.2, 0.3, 0.4)])
        mesh = FakeFaceMesh([], error=RuntimeError("test inference failure"))
        with (
            patch.object(main, "face_detector", detector),
            patch.object(main, "face_mesh", mesh),
        ):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(main.analyze(frame))
        self.assertEqual(raised.exception.status_code, 503)

    def test_rejects_empty_corrupt_unsupported_and_mismatched_images(self):
        cases = [
            (b"", "image/jpeg", 400),
            (b"\xff\xd8\xffnot-a-decodable-jpeg", "image/jpeg", 400),
            (b"\xff\xd8\xff", "image/gif", 415),
            (b"\x89PNG\r\n\x1a\n", "image/jpeg", 415),
        ]
        for content, content_type, status in cases:
            with self.subTest(content_type=content_type, status=status):
                with self.assertRaises(HTTPException) as raised:
                    asyncio.run(main.analyze(make_upload(content, content_type)))
                self.assertEqual(raised.exception.status_code, status)

    def test_rejects_oversized_and_too_small_images(self):
        oversized = b"\xff\xd8\xff" + b"x" * main.MAX_IMAGE_BYTES
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(main.analyze(make_upload(oversized)))
        self.assertEqual(raised.exception.status_code, 413)

        tiny = np.zeros((16, 16, 3), dtype=np.uint8)
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(main.analyze(make_upload(encode_test_image(tiny))))
        self.assertEqual(raised.exception.status_code, 422)

    def test_device_class_mapping_includes_supported_screen_categories(self):
        self.assertEqual(device_kind_for_class("cell phone"), "phone")
        self.assertEqual(device_kind_for_class("Mobile_Phone"), "phone")
        self.assertEqual(device_kind_for_class("tablet"), "tablet")
        self.assertEqual(device_kind_for_class("laptop"), "laptop")
        self.assertEqual(device_kind_for_class("tv"), "screen")

    def test_phone_model_classes_are_supported_for_lists_and_mappings(self):
        self.assertEqual(phone_class_ids(["person", "cell phone"]), {1})
        self.assertEqual(phone_class_ids({0: "person", 67: "cell phone"}), {67})
        self.assertEqual(phone_class_ids({0: "mobile home", 1: "laptop"}), set())
        self.assertEqual(class_names_by_id(["person", "phone"]), {0: "person", 1: "phone"})

    def test_phone_prediction_is_reported_with_model_box_and_confidence(self):
        yolo = FakeYolo("cell phone")
        with patch.object(main, "yolo", yolo):
            result = asyncio.run(main.analyze(make_test_frame()))

        self.assertEqual(result["phone_detection"], "detected")
        self.assertEqual(result["phone_model"], "configured")
        self.assertEqual(yolo.device, "cpu")
        self.assertEqual(result["phone_confidence"], 0.91)
        self.assertEqual(result["phone_boxes"][0]["label"], "cell phone")
        self.assertEqual(
            set(result["inference_stages_ms"]),
            {
                "image_decode_ms",
                "resize_ms",
                "face_detection_ms",
                "head_pose_ms",
                "phone_detection_ms",
                "postprocessing_ms",
                "total_ms",
            },
        )
        self.assertTrue(all(value >= 0 for value in result["inference_stages_ms"].values()))
        self.assertEqual(result["inference_stages_ms"]["total_ms"], result["inference_ms"])

    def test_selected_yolo_device_is_used_for_prediction(self):
        yolo = FakeYolo("cell phone")
        with (
            patch.object(main, "yolo", yolo),
            patch.object(main, "YOLO_DEVICE", "cuda"),
        ):
            result = asyncio.run(main.analyze(make_test_frame()))

        self.assertEqual(result["phone_detection"], "detected")
        self.assertEqual(yolo.device, "cuda")

    def test_frame_quality_statistics_match_combined_numpy_statistics(self):
        image = np.random.default_rng(42).integers(0, 256, (64, 80, 3), dtype=np.uint8)

        mean, standard_deviation = main.frame_quality_statistics(image)

        self.assertAlmostEqual(mean, float(np.mean(image)), places=10)
        self.assertAlmostEqual(standard_deviation, float(np.std(image)), places=10)

    def test_loaded_model_without_phone_class_does_not_report_false_negative(self):
        with patch.object(main, "yolo", FakeYolo("person")):
            result = asyncio.run(main.analyze(make_test_frame()))

        self.assertEqual(result["phone_detection"], "unavailable")
        self.assertEqual(result["phone_model"], "unavailable")
        self.assertEqual(result["phone_boxes"], [])

    def test_phone_inference_failure_is_reported_as_service_unavailable(self):
        class FailingYolo:
            names = {67: "cell phone"}

            def predict(self, **_kwargs):
                raise RuntimeError("test inference failure")

        frame = make_test_frame()
        detector = FakeFaceDetector(detections=[])
        with (
            patch.object(main, "face_detector", detector),
            patch.object(main, "yolo", FailingYolo()),
        ):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(main.analyze(frame))
        self.assertEqual(raised.exception.status_code, 503)

    def test_phone_model_empty_prediction_is_reported_as_service_unavailable(self):
        class EmptyYolo:
            names = {67: "cell phone"}

            def predict(self, **_kwargs):
                return []

        frame = make_test_frame()
        detector = FakeFaceDetector(detections=[])
        with (
            patch.object(main, "face_detector", detector),
            patch.object(main, "yolo", EmptyYolo()),
        ):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(main.analyze(frame))
        self.assertEqual(raised.exception.status_code, 503)

    def test_readability_is_a_low_confidence_pixel_scale_heuristic(self):
        device = {"kind": "laptop", "label": "laptop", "confidence": 0.9, "box": [100, 100, 500, 550]}
        face = {"x": 0.45, "y": 0.2, "width": 0.1, "height": 0.2}
        assessment = assess_visual_readability(
            [device],
            1,
            [face],
            {"yaw_degrees": 3},
            (600, 640, 3),
            "ok",
        )
        self.assertEqual(assessment["status"], "potentially_readable")
        self.assertEqual(assessment["confidence"], "low")
        self.assertEqual(assessment["devices"][0]["estimated_distance_band"], "near")
        self.assertIn("no OCR", assessment["basis"])

        no_face = assess_visual_readability([device], 0, [], None, (600, 640, 3), "ok")
        self.assertEqual(no_face["status"], "not_indicated")


class InferenceControlTests(unittest.TestCase):
    def setUp(self):
        self.previous_runtime = (
            main.INFERENCE_MIN_INTERVAL_SECONDS,
            main.INFERENCE_TIMEOUT_SECONDS,
            main._last_inference_started_at,
        )
        main.INFERENCE_MIN_INTERVAL_SECONDS = 0
        main._last_inference_started_at = 0

    def tearDown(self):
        (
            main.INFERENCE_MIN_INTERVAL_SECONDS,
            main.INFERENCE_TIMEOUT_SECONDS,
            main._last_inference_started_at,
        ) = self.previous_runtime

    def test_concurrent_inference_is_rejected_without_waiting(self):
        worker_started = threading.Event()
        release_worker = threading.Event()

        def blocked_inference(_content, _content_type):
            worker_started.set()
            if not release_worker.wait(3):
                raise RuntimeError("test inference was not released")
            return {"completed": True}

        async def exercise():
            first = asyncio.create_task(main.analyze(make_test_frame()))
            self.assertTrue(await asyncio.to_thread(worker_started.wait, 1))

            with self.assertRaises(HTTPException) as raised:
                await main.analyze(make_test_frame())
            self.assertEqual(raised.exception.status_code, 503)
            self.assertEqual(main.health()["phone_model"], "unavailable")

            release_worker.set()
            self.assertEqual(await first, {"completed": True})

        try:
            with patch.object(main, "_analyze_content", side_effect=blocked_inference):
                asyncio.run(exercise())
        finally:
            release_worker.set()

    def test_inference_throttle_returns_retry_after_without_running_model(self):
        main.INFERENCE_MIN_INTERVAL_SECONDS = 5
        main._last_inference_started_at = time.monotonic()
        with patch.object(main, "_analyze_content") as inference:
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(main.analyze(make_test_frame()))

        self.assertEqual(raised.exception.status_code, 429)
        self.assertIn("Retry-After", raised.exception.headers)
        inference.assert_not_called()

    def test_inference_timeout_keeps_capacity_busy_until_worker_finishes(self):
        worker_started = threading.Event()
        release_worker = threading.Event()
        worker_finished = threading.Event()
        main.INFERENCE_TIMEOUT_SECONDS = 0.02

        def blocked_inference(_content, _content_type):
            worker_started.set()
            if not release_worker.wait(3):
                raise RuntimeError("test inference was not released")
            worker_finished.set()
            return {"completed": True}

        async def exercise():
            first = asyncio.create_task(main.analyze(make_test_frame()))
            self.assertTrue(await asyncio.to_thread(worker_started.wait, 1))

            with self.assertRaises(HTTPException) as timed_out:
                await first
            self.assertEqual(timed_out.exception.status_code, 504)

            with self.assertRaises(HTTPException) as still_busy:
                await main.analyze(make_test_frame())
            self.assertEqual(still_busy.exception.status_code, 503)

            release_worker.set()
            self.assertTrue(await asyncio.to_thread(worker_finished.wait, 2))
            await asyncio.sleep(0)
            self.assertEqual(await main.analyze(make_test_frame()), {"completed": True})

        try:
            with patch.object(main, "_analyze_content", side_effect=blocked_inference):
                asyncio.run(exercise())
        finally:
            release_worker.set()


if __name__ == "__main__":
    unittest.main()
