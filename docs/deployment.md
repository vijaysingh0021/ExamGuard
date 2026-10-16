# Deployment and troubleshooting

## Services

- Client: `npm run dev -w client` (port 5173)
- API: `npm run dev -w server` (port 4000)
- AI service: `cd ai-service; uvicorn main:app --port 8000`

Use `npm run build` for production artifacts. Provide `MONGODB_URI`, `MONGODB_DB_NAME`, and a unique 32+ character `JWT_SECRET` to the API environment. Do not place any server secret in a Vite `VITE_*` variable.

MongoDB Atlas must permit the deployed API's outbound IP/network and use a least-privilege database user. The application does not fall back to a local database.

Configure an S3-compatible private bucket using every `OBJECT_STORAGE_*` value. Block public bucket access, require encryption at rest, and scope credentials to the configured bucket/prefix. Candidate documents are not publicly downloadable; document-download routes should be added only with per-object authorization and short-lived signed URLs.

Email variables are reserved for a future provider adapter. This build deliberately reports email delivery as unavailable and delivers notifications persistently in-app; configuration alone never implies that an email was sent.

## Social sign-in

Google and Microsoft use server-side OpenID Connect authorization-code flows. Set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` or `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET`, plus `API_BASE_URL`. Register exact callbacks: `${API_BASE_URL}/api/auth/oauth/google/callback` and `${API_BASE_URL}/api/auth/oauth/microsoft/callback`. Buttons appear only when both credentials are configured. The flow uses PKCE, state, nonce, and validated ID-token claims. Provider identities must be explicitly linked in `AuthIdentity`; they are never auto-linked from an email match.

The AI service is optional and must be separately deployed. Its `/health` endpoint accurately reports MediaPipe and the optional YOLO phone-model state; do not enable phone-detection policies until a validated model is configured with `YOLO_MODEL_PATH`.

## Troubleshooting

- **API exits on startup:** validate Atlas URI, database name, JWT secret, and Atlas network access.
- **Uploads fail:** configure private storage values and ensure the bucket allows server credentials to write.
- **Email is unavailable:** leave it unset for in-app-only delivery or configure both email variables.
- **AI says unavailable:** install `ai-service/requirements.txt` in an isolated Python environment; set `YOLO_MODEL_PATH` only for a tested model.
- **Live-monitoring subscription rejected:** sign in with an active institute-admin, teacher, or proctor membership for the requested organization.
