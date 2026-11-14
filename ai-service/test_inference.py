import asyncio
from io import BytesIO
from types import SimpleNamespace
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

    def predict(self, **_kwargs):
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


class FakeFaceMesh:
    def __init__(self, faces):
        self.faces = faces

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def process(self, _image):
        return SimpleNamespace(multi_face_landmarks=self.faces)


class HeadPoseTests(unittest.TestCase):
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
                main.mp.solutions.face_detection,
                "FaceDetection",
                return_value=FakeFaceDetector(detections, expected_shape=(480, 640)),
            ),
            patch.object(main.mp.solutions.face_mesh, "FaceMesh", return_value=FakeFaceMesh([])),
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

    def test_face_model_errors_are_reported_as_service_unavailable(self):
        frame = make_test_frame()
        detector = FakeFaceDetector(error=RuntimeError("test inference failure"))
        with patch.object(main.mp.solutions.face_detection, "FaceDetection", return_value=detector):
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
        with patch.object(main, "yolo", FakeYolo("cell phone")):
            result = asyncio.run(main.analyze(make_test_frame()))

        self.assertEqual(result["phone_detection"], "detected")
        self.assertEqual(result["phone_model"], "configured")
        self.assertEqual(result["phone_confidence"], 0.91)
        self.assertEqual(result["phone_boxes"][0]["label"], "cell phone")

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
            patch.object(main.mp.solutions.face_detection, "FaceDetection", return_value=detector),
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
            patch.object(main.mp.solutions.face_detection, "FaceDetection", return_value=detector),
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


if __name__ == "__main__":
    unittest.main()
