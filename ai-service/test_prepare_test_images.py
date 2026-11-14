import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

import prepare_test_images


class PrepareTestImagesTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary_directory.name)
        self.addCleanup(self.temporary_directory.cleanup)
        self.previous_here = prepare_test_images.HERE
        prepare_test_images.HERE = self.directory
        self.addCleanup(setattr, prepare_test_images, "HERE", self.previous_here)

    def write_image(self, name, color):
        image = np.full((120, 160, 3), color, dtype=np.uint8)
        success, encoded = cv2.imencode(".png", image)
        self.assertTrue(success)
        path = self.directory / name
        path.write_bytes(encoded.tobytes())
        return path

    def test_prepares_two_validated_jpegs(self):
        phone_source = self.write_image("source-phone.png", (0, 0, 255))
        faces_source = self.write_image("source-faces.png", (0, 255, 0))

        results = prepare_test_images.prepare(phone_source, faces_source)

        self.assertEqual([item[0] for item in results], ["test-phone.jpg", "test-faces.jpg"])
        for name, width, height in results:
            output = self.directory / name
            self.assertTrue(output.is_file())
            self.assertGreater(output.stat().st_size, 0)
            self.assertEqual((width, height), (160, 120))
            self.assertIsNotNone(cv2.imread(str(output), cv2.IMREAD_COLOR))

    def test_rejects_invalid_source_without_creating_outputs(self):
        phone_source = self.directory / "corrupt.png"
        phone_source.write_bytes(b"not an image")
        faces_source = self.write_image("source-faces.png", (0, 255, 0))

        with self.assertRaises(ValueError):
            prepare_test_images.prepare(phone_source, faces_source)
        self.assertFalse((self.directory / "test-phone.jpg").exists())
        self.assertFalse((self.directory / "test-faces.jpg").exists())

    def test_refuses_to_overwrite_nonempty_test_images(self):
        phone_source = self.write_image("source-phone.png", (0, 0, 255))
        faces_source = self.write_image("source-faces.png", (0, 255, 0))
        existing = self.directory / "test-phone.jpg"
        existing.write_bytes(b"preserve this user file")

        with self.assertRaises(FileExistsError):
            prepare_test_images.prepare(phone_source, faces_source)
        self.assertEqual(existing.read_bytes(), b"preserve this user file")
        self.assertFalse((self.directory / "test-faces.jpg").exists())

    def test_only_explicit_flag_replaces_zero_byte_placeholder(self):
        phone_source = self.write_image("source-phone.png", (0, 0, 255))
        faces_source = self.write_image("source-faces.png", (0, 255, 0))
        placeholder = self.directory / "test-phone.jpg"
        placeholder.write_bytes(b"")

        with self.assertRaises(FileExistsError):
            prepare_test_images.prepare(phone_source, faces_source)

        results = prepare_test_images.prepare(
            phone_source,
            faces_source,
            replace_empty_placeholder=True,
        )
        self.assertEqual(len(results), 2)
        self.assertGreater(placeholder.stat().st_size, 0)

    def test_refuses_source_that_is_also_an_output(self):
        phone_source = self.directory / "test-phone.jpg"
        success, encoded = cv2.imencode(".jpg", np.zeros((120, 160, 3), dtype=np.uint8))
        self.assertTrue(success)
        phone_source.write_bytes(encoded.tobytes())
        faces_source = self.write_image("source-faces.png", (0, 255, 0))

        with self.assertRaises(ValueError):
            prepare_test_images.prepare(phone_source, faces_source)


if __name__ == "__main__":
    unittest.main()
