"""Real-model checks kept separate from mocked unit tests."""

import asyncio
from io import BytesIO
from pathlib import Path
import unittest

import cv2
import numpy as np
from starlette.datastructures import Headers, UploadFile

import main


ASSET_DIRECTORY = Path(__file__).resolve().parent
MODEL_SKIP_REASON = "Real YOLO model is unavailable; configure YOLO_MODEL_PATH to run model checks."


def load_asset(name):
    path = ASSET_DIRECTORY / name
    if not path.is_file() or path.stat().st_size == 0:
        return None, f"{name} is missing or empty; provide an authorized sample image."
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        return None, f"{name} is not a readable image; replace it with an authorized sample."
    return image, None


def analyze_image(image, name):
    success, encoded = cv2.imencode(".jpg", image)
    if not success:
        raise AssertionError(f"Could not encode {name} for inference.")
    frame = UploadFile(
        filename=name,
        file=BytesIO(encoded.tobytes()),
        headers=Headers({"content-type": "image/jpeg"}),
    )
    return asyncio.run(main.analyze(frame))


class RealModelInferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.previous_min_interval = main.INFERENCE_MIN_INTERVAL_SECONDS
        main.INFERENCE_MIN_INTERVAL_SECONDS = 0
        main.initialize_models()

    @classmethod
    def tearDownClass(cls):
        main.close_models()
        main.INFERENCE_MIN_INTERVAL_SECONDS = cls.previous_min_interval
        super().tearDownClass()

    def setUp(self):
        if main.yolo is None or not main.phone_class_ids(main.MODEL_CLASSES):
            self.skipTest(MODEL_SKIP_REASON)

    def test_synthetic_no_person_no_phone_frame(self):
        image = np.zeros((480, 640, 3), dtype=np.uint8)
        result = analyze_image(image, "synthetic-no-face.jpg")

        self.assertEqual(result["face_count"], 0)
        self.assertFalse(result["multiple_faces"])
        self.assertEqual(result["face_pose_estimates"], [])
        self.assertEqual(result["phone_detection"], "not_detected")
        self.assertIsNone(result["phone_confidence"])
        self.assertEqual(result["phone_boxes"], [])

    def test_authorized_camera_sample_is_one_face_and_no_phone(self):
        image, reason = load_asset("camera_test.jpg")
        if reason:
            self.skipTest(reason)
        result = analyze_image(image, "camera_test.jpg")

        self.assertEqual(result["face_count"], 1)
        self.assertFalse(result["multiple_faces"])
        self.assertEqual(len(result["face_boxes"]), 1)
        self.assertEqual(len(result["face_pose_estimates"]), 1)
        self.assertGreaterEqual(result["face_boxes"][0]["confidence"], main.FACE_CONFIDENCE_THRESHOLD)
        self.assertEqual(result["phone_detection"], "not_detected")
        self.assertIsNone(result["phone_confidence"])
        self.assertEqual(result["phone_boxes"], [])
        self.assertIsNotNone(result["head_pose"])
        self.assertEqual(result["looking_away"], "looking_forward")

    def test_local_phone_sample_has_a_threshold_qualified_box(self):
        image, reason = load_asset("test-phone.jpg")
        if reason:
            self.skipTest(reason)
        result = analyze_image(image, "test-phone.jpg")

        self.assertEqual(result["phone_detection"], "detected")
        self.assertIsNotNone(result["phone_confidence"])
        self.assertGreaterEqual(result["phone_confidence"], main.PHONE_CONFIDENCE_THRESHOLD)
        self.assertGreater(len(result["phone_boxes"]), 0)
        height, width = image.shape[:2]
        for box in result["phone_boxes"]:
            self.assertEqual(box["label"].lower(), "cell phone")
            self.assertGreaterEqual(box["confidence"], main.PHONE_CONFIDENCE_THRESHOLD)
            self.assertGreaterEqual(box["x1"], 0)
            self.assertGreaterEqual(box["y1"], 0)
            self.assertLessEqual(box["x2"], width)
            self.assertLessEqual(box["y2"], height)
            self.assertGreater(box["x2"], box["x1"])
            self.assertGreater(box["y2"], box["y1"])

    def test_local_multiple_face_sample_detects_at_least_two_faces(self):
        image, reason = load_asset("test-faces.jpg")
        if reason:
            self.skipTest(reason)
        result = analyze_image(image, "test-faces.jpg")

        self.assertEqual(result["face_count"], 8)
        self.assertTrue(result["multiple_faces"])
        self.assertGreaterEqual(len(result["face_boxes"]), 2)
        self.assertEqual(len(result["face_pose_estimates"]), result["face_count"])
        for box in result["face_boxes"]:
            self.assertIsNotNone(box["confidence"])
            self.assertGreaterEqual(box["confidence"], main.FACE_CONFIDENCE_THRESHOLD)
            self.assertGreaterEqual(box["x"], 0)
            self.assertGreaterEqual(box["y"], 0)
            self.assertLessEqual(box["x"] + box["width"], 1)
            self.assertLessEqual(box["y"] + box["height"], 1)
        self.assertIsNone(result["head_pose"])
        self.assertEqual(result["looking_away"], "unavailable")

    def test_optional_far_phone_sample(self):
        image, reason = load_asset("test-phone-far.jpg")
        if reason:
            self.skipTest(reason)
        result = analyze_image(image, "test-phone-far.jpg")
        self.assertEqual(result["phone_detection"], "detected")
        self.assertGreaterEqual(result["phone_confidence"], main.PHONE_CONFIDENCE_THRESHOLD)
        self.assertTrue(result["phone_boxes"])

    def test_optional_partially_occluded_phone_sample(self):
        image, reason = load_asset("test-phone-occluded.jpg")
        if reason:
            self.skipTest(reason)
        result = analyze_image(image, "test-phone-occluded.jpg")
        self.assertEqual(result["phone_detection"], "detected")
        self.assertGreaterEqual(result["phone_confidence"], main.PHONE_CONFIDENCE_THRESHOLD)
        self.assertTrue(result["phone_boxes"])

    def test_optional_no_phone_sample(self):
        image, reason = load_asset("test-no-phone.jpg")
        if reason:
            self.skipTest(reason)
        result = analyze_image(image, "test-no-phone.jpg")
        self.assertEqual(result["phone_detection"], "not_detected")
        self.assertIsNone(result["phone_confidence"])
        self.assertEqual(result["phone_boxes"], [])

    def test_optional_many_faces_sample(self):
        image, reason = load_asset("test-many-faces.jpg")
        if reason:
            self.skipTest(reason)
        result = analyze_image(image, "test-many-faces.jpg")
        self.assertGreater(result["face_count"], 2)
        self.assertTrue(result["multiple_faces"])

    def test_optional_no_face_photo_sample(self):
        image, reason = load_asset("test-no-faces.jpg")
        if reason:
            self.skipTest(reason)
        result = analyze_image(image, "test-no-faces.jpg")
        self.assertEqual(result["face_count"], 0)
        self.assertFalse(result["multiple_faces"])

    def test_optional_looking_away_pair(self):
        forward_image, forward_reason = load_asset("test-looking-forward.jpg")
        away_image, away_reason = load_asset("test-looking-away.jpg")
        if forward_reason or away_reason:
            missing = forward_reason or away_reason
            self.skipTest(f"Provide both authorized pose samples: {missing}")

        forward = analyze_image(forward_image, "test-looking-forward.jpg")
        away = analyze_image(away_image, "test-looking-away.jpg")
        self.assertEqual(forward["face_count"], 1)
        self.assertEqual(away["face_count"], 1)
        self.assertIsNotNone(forward["head_pose"])
        self.assertIsNotNone(away["head_pose"])
        self.assertEqual(forward["looking_away"], "looking_forward")
        self.assertEqual(away["looking_away"], "looking_away")


if __name__ == "__main__":
    unittest.main()
