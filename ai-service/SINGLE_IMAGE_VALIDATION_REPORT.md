# ExamGuard Single-Image AI Validation Report

**Validation date:** 2026-11-15  
**Input:** The exact user-supplied `Pasted Image.png`; the attachment was read in place and not modified or copied.  
**Inference:** Authenticated `POST http://127.0.0.1:8001/analyze`, using the existing live service and its configured YOLO and MediaPipe models.

## 1. Visual inspection

The input is a 1152 × 768 PNG collage with nine labeled panels, not a single camera view.

- **Faces:** 12 visible in total: one each in panels 1, 2, 5, 6, and 7; two each in panels 3 and 4; none in panel 8; and three in panel 9.
- **Phones:** Two are visibly held: one in panel 2 and one in panel 4.
- **Head direction:** The person in panel 5 is turned to the right, the person in panel 6 is turned to the left, and the person in panel 7 is looking down. This is visual inspection of a static image, not eye-gaze measurement.
- **Other devices:** No laptop, tablet, or other electronic device is visibly present.

## 2. Actual AI inference

The submitted file was 1,682,279 bytes, PNG/RGBA, 1152 × 768. Its SHA-256 was:

`4ED6A32D8D59C1103EC44592E4A5DC48DB32CA980F7ADC6F71EEE5F189198333`

The API returned HTTP 200. The status code is not treated as a detection result; the model fields below are the inference result.

```json
{
  "face_count": 11,
  "face_presence": true,
  "multiple_faces": true,
  "face_boxes": [
    {"x":0.2055,"y":0.4635,"width":0.0538,"height":0.0808,"confidence":0.878},
    {"x":0.8398,"y":0.1442,"width":0.0769,"height":0.1153,"confidence":0.871},
    {"x":0.4521,"y":0.1205,"width":0.0824,"height":0.1236,"confidence":0.868},
    {"x":0.1275,"y":0.1235,"width":0.0785,"height":0.1177,"confidence":0.862},
    {"x":0.9108,"y":0.8021,"width":0.0636,"height":0.0954,"confidence":0.843},
    {"x":0.4815,"y":0.4711,"width":0.079,"height":0.1186,"confidence":0.806},
    {"x":0.1337,"y":0.8159,"width":0.0778,"height":0.1167,"confidence":0.800},
    {"x":0.7384,"y":0.1391,"width":0.0624,"height":0.0936,"confidence":0.781},
    {"x":0.0876,"y":0.4721,"width":0.0732,"height":0.1098,"confidence":0.762},
    {"x":0.7756,"y":0.4622,"width":0.075,"height":0.1126,"confidence":0.743},
    {"x":0.7932,"y":0.8122,"width":0.0787,"height":0.1181,"confidence":0.652}
  ],
  "phone_detection": "detected",
  "phone_confidence": 0.81,
  "phone_boxes": [
    {"x1":277.36,"y1":420.3,"x2":325.78,"y2":482.8,"confidence":0.81,"label":"cell phone"},
    {"x1":645.28,"y1":120.08,"x2":715.49,"y2":211.22,"confidence":0.63,"label":"cell phone"}
  ],
  "visible_devices": [
    {"kind":"phone","label":"cell phone","confidence":0.81,"box":[277.36,420.3,325.78,482.8]},
    {"kind":"phone","label":"cell phone","confidence":0.63,"box":[645.28,120.08,715.49,211.22]}
  ],
  "looking_away": "unavailable",
  "head_pose": null,
  "inference_ms": 360.04
}
```

The face boxes use normalized image coordinates; phone/device boxes use input-image pixel coordinates.

## 3. Expected versus actual

| Signal | Visually expected | Actual | Assessment |
|---|---:|---:|---|
| Face count | 12 | 11 | One face was missed. The boxes match the other visible faces; the likely miss is the left-most face in panel 9. |
| Face present | Yes | Yes | Correct. |
| Multiple faces | Yes | Yes | Correct for this composite image. |
| Phone | 2 | 2 | Both visible phones were detected as `cell phone`; no phone false positive was apparent. |
| Other supported visible devices | 0 | 0 | No non-phone device was reported; none was visibly present. |
| Looking away/down | Side-turns and downward pose appear in panels 5–7 | `unavailable` | Not evaluated per face: the service returns a single head-pose estimate only when exactly one face is detected. |

This image therefore contains a face false negative (11/12) but no apparent phone false positive or phone false negative. The `looking_away` result is unavailable, not a successful looking-away classification.

## 4. Model/configuration diagnostics

- The live service reported MediaPipe and the YOLO phone model ready, with the recognized phone class `cell phone`.
- Current face inference uses MediaPipe `model_selection=1` and confidence threshold 0.5. YOLO uses the existing phone threshold 0.35; the phone class mapping is `cell phone`.
- On this exact collage, MediaPipe model selection 1 returned 11 faces (scores 0.652–0.878). Model selection 0 returned only 2 (scores 0.572 and 0.608).
- Re-running MediaPipe model selection 1 at thresholds 0.3, 0.4, 0.5, and 0.6 returned the same 11 detections and scores. Lowering the threshold did not recover the missed face.
- No preprocessing or input resizing was applied by this validation request before upload. The original PNG bytes were sent to the service.

The observed miss is not explained by the configured confidence cutoff, and changing back to model selection 0 makes this image's result worse. No model or threshold change is justified by this single composite image.

## 5. Backend integration and temporal qualification

The backend maps `multiple_faces`, `phone_detection == "detected"`, and `looking_away == "looking_away"` to their corresponding AI review signals. The existing rolling rule requires at least three positive frames in the most recent five for a signal to qualify.

Validation performed:

- `server/test/ai-monitoring.test.ts`: 3 tests passed, including three-of-five qualification and negative-frame behavior.
- `server/test/ai-service-integration.check.ts`: passed. It verifies authenticated readiness, real camera-sample forwarding, consent/heartbeat guards, simulated phone/multiple-face/looking-away mapping, qualification, and event/evidence handling. Its simulated positive cases are backend contract tests, not detections from this collage.

This single-image request did **not** create an incident or establish temporal qualification. The frame route also requires an active authorized attempt, recorded monitoring consent, a recent active Windows Companion heartbeat, and configured evidence handling before qualifying/storing events.

## 6. Initial validation conclusion (before follow-up)

- **Inference code changes for this validation:** None. The existing long-range MediaPipe selection was retained because it substantially outperformed model selection 0 on this image; the phone threshold was not lowered.
- **Report created:** `ai-service/SINGLE_IMAGE_VALIDATION_REPORT.md`.
- The input is a labeled collage, not a representative live webcam frame. Results do not establish phone/face accuracy across camera distances, lighting, occlusion, or live exams.
- Looking-away and looking-down need separately validated single-face frames (or a deliberately per-face pose pipeline). They cannot be confirmed by this API result because the service returns `head_pose: null` when multiple faces are present.
- One frame cannot validate three-of-five event behavior, Companion availability, incident persistence, or end-to-end live camera capture.
- Do not use this result alone to infer misconduct or penalize a candidate.

## 7. Follow-up validation and changes

**Follow-up date:** 2026-11-15. The exact same attachment bytes were used (SHA-256 unchanged: `4ED6A32D8D59C1103EC44592E4A5DC48DB32CA980F7ADC6F71EEE5F189198333`). Inference ran from the updated local Python source with the configured YOLO weights and MediaPipe; no predictions were mocked.

### Face-count miss and refinement

The original full-frame detector returned 11 faces. Upscaling the whole frame did not improve that result. A 3×3 set of overlapping crops at the same `FACE_CONFIDENCE_THRESHOLD=0.5` recovered the face at the lower-left of panel 9, with confidence 0.861. This supports a scale/density limitation in the full-frame pass, not an overly high confidence threshold. The service now runs that tiled refinement only after a full-frame pass finds at least two faces, maps boxes back to the original frame, and merges overlaps at IoU 0.35.

| Real input | Before | After | Assessment |
|---|---:|---:|---|
| Supplied collage, visually 12 faces | 11 | 12 | The omitted panel-9 face was recovered; no extra box remained after deduplication. |
| Local group photo, visually 8 faces | 8 | 8 | Tiled refinement did not add a face or duplicate. |
| Consented camera sample, one face | 1 | 1 | Single-face detection is unchanged. |
| Synthetic blank frame | 0 | 0 | No face false positive in this negative check. |

This improves the specific supplied image and these local checks; it is not a general accuracy guarantee. Refinement is not attempted when the full-frame pass finds fewer than two faces, so a frame where all but one face are missed still needs further work. Confidence thresholds were not lowered.

### Multiple-face head pose

The service now returns `face_pose_estimates`, associating each estimate with that frame's `face_box`. Each face is processed in a cropped region, and a landmark-center check rejects a pose if the mesh appears to belong elsewhere. On the collage, 2 of 12 per-face estimates crossed the configured thresholds, matching the two visually side-turned people in panels 5 and 6. The downward-looking person in panel 7 was **not** classified as looking away (measured pitch −12.67°, versus the 30° effective threshold). Looking-down detection therefore remains unvalidated and was not forced by lowering thresholds.

For multiple faces, the aggregate `head_pose` stays null and aggregate `looking_away` stays `unavailable`; per-face estimates do not feed the candidate-level temporal signal. A backend integration check supplied two face observations (one turned, one forward) and verified that this does not create a `looking_away` event. A separate single-face sequence still qualifies a looking-away signal under the existing rule.

The face-to-box association is **frame-local, not persistent identity tracking**. There is no trustworthy candidate identity or track ID across these stateless frame requests. Adding temporal person tracking would require an attempt-scoped tracker and a reliable subject-anchor/association contract; assigning an arbitrary face or using face recognition would risk misattribution. Until that is designed and validated, multi-face observations remain diagnostic only.

### Phone detection regression

YOLO weights, COCO `cell phone` mapping, and the 0.35 phone threshold were unchanged. On the collage, the same two phones remained detected with confidences 0.81 and 0.63 before and after face refinement. The local positive phone sample was detected at 0.481; the camera sample and synthetic blank remained phone-negative. No phone regression was observed in these checks.

### Temporal and integration checks

- The temporal unit test now explicitly feeds five frames `[positive, negative, positive, negative, positive]`; qualification occurs only on frame 5, the third positive in the rolling window.
- `server/test/ai-service-integration.check.ts` passed: authentication, ownership, consent, heartbeat, the simulated per-face payload, no multi-face looking-away attribution, single-face looking-away qualification, 3-of-5 confirmation, and evidence/event handling. It used no database and did not create an incident from the collage.
- AI suite: **37 tests run, 31 passed, 6 skipped** because optional far/occluded/no-phone/many-face/no-face/pose-pair images are absent.
- Backend temporal tests: **4 passed**.
- Backend TypeScript typecheck: passed.

The configured AI service process was not restarted during this work. The updated inference behavior was tested by importing the local source and running real model inference; the backend integration check remained compatible with the already-running endpoint. Restart the existing AI service in its current terminal to load the updated source; do not start a second listener on port 8001.

### Remaining limitations

- Warm in-process inference on the collage measured 334–436 ms over two repeated runs; the first measured run was 2,666 ms. These are local measurements, not hardware-independent latency guarantees.
- The collage is synthetic/composite and does not validate live camera tracking, lighting/distance coverage, or identity association.
- Head pose estimates head orientation, not eye gaze; the downward pose remained a false negative in this sample.
- No incident was created from the supplied image. It cannot establish temporal qualification or justify penalizing a candidate.
