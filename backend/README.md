# DocuMind LangGraph API

## Setup

From the repository root, create the virtual environment once if it does not exist:

```powershell
py -m venv .venv
```

Install dependencies and configure `.env`:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Set `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`) and the provider keys you use in `.env`. Keep secrets server-side; never add a `NEXT_PUBLIC_` prefix. Set `LLM_PROVIDER=openai` or `LLM_PROVIDER=huggingface` to choose the chat/analysis provider. Set `EMBEDDING_PROVIDER` independently to `openai` or `huggingface`. Both default to OpenAI, preserving an existing OpenAI setup; OpenAI requires `OPENAI_API_KEY`. Hugging Face requires `HF_TOKEN` with permission to call Inference Providers; its default chat and embedding models are `openai/gpt-oss-120b:cheapest` and `Qwen/Qwen3-Embedding-0.6B` (1024 dimensions). Provider use may be billable.

The Hugging Face chat integration uses an OpenAI-compatible LangChain client pointed at Hugging Face's router; it does not call the OpenAI API.

Apply the full, latest `supabase/schema.sql` in the Supabase SQL Editor. It retains the existing 1536-dimensional embeddings and adds a separate 1024-dimensional Hugging Face vector column and matching search RPC, so the existing vectors are not overwritten.

The selected embedding provider determines which vector column is written and searched: OpenAI uses `embedding` (1536 dimensions), while Hugging Face uses `embedding_hf` (1024 dimensions). Keep the provider consistent for indexing and search. If switching to Hugging Face, run the reindex script below for existing chunks.

For Outline sync, configure `OUTLINE_BASE_URL`, `OUTLINE_API_KEY`, `OUTLINE_COLLECTION_ID`, and `OUTLINE_COLLECTION_NAME` in the backend `.env`. The API key stays server-side. Knowledge-page sync lists the collection, fetches each document's text, and stores source metadata, chunks, and embeddings in Supabase. The source's document count is refreshed from the stored records.

GitHub, web URL, and Notion credentials are entered in the knowledge-source form, encrypted, and stored server-side. Set a stable random `SOURCE_CREDENTIALS_KEY` in `.env`; keep it private and back it up, because rotating this key makes existing saved credentials unreadable. GitHub sync indexes README and Markdown/text files, web sync crawls up to eight same-host HTML pages, and Notion sync indexes pages shared with the integration.

### Supabase Auth

The assistant, document, knowledge, search, Google Drive, and Microsoft Teams features require a Supabase Auth session. Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for Next.js, and `SUPABASE_URL` plus `SUPABASE_ANON_KEY` for the Python backend. The backend validates each bearer token with Supabase Auth. Keep `SUPABASE_SECRET_KEY`/`SUPABASE_SERVICE_ROLE_KEY` server-side; it is not the public Auth key.

In Supabase Authentication settings, enable Email and Google providers. Set the local Site URL to `http://localhost:3000` and allow `http://localhost:3000/auth/callback` as a redirect URL. Add the corresponding deployed site URL and `/auth/callback` for production. For Google, configure the OAuth client in Supabase's Google provider settings and allow the Supabase-provided callback URI in Google Cloud Console. This login callback is separate from the Google Drive callback at `/api/google-drive/auth/callback`.

To brand signup confirmation emails, set the **Confirm signup** subject to `Verifikasi akun Hutabyte` and paste `supabase/email-templates/confirm-signup.html` into the template body in Supabase Authentication → Email Templates. The logo is loaded from `{{ .SiteURL }}/logo-hutabyte.png`; set the Supabase Site URL to the deployed web app so recipients can load it. Keep the local callback URL in the redirect allowlist for development.

The app currently uses a shared workspace: authenticated accounts see the same documents and conversations. Authentication gates access but does not partition records by user.

### Microsoft Teams

Register a Microsoft Entra ID application as a **Web** app and add the exact `MICROSOFT_REDIRECT_URI` as a redirect URI. Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, and `MICROSOFT_REDIRECT_URI` in the backend `.env`. Never add the client secret to a `NEXT_PUBLIC_` variable. Grant delegated Microsoft Graph permissions `User.Read`, `Team.ReadBasic.All`, `Channel.ReadBasic.All`, and `ChannelMessage.Read.All`; grant admin consent if your tenant requires it. Then apply the latest `supabase/schema.sql` and restart the backend.

The Teams page supports Microsoft sign-in, listing joined teams/channels, and syncing channel messages into `platform_messages` with `platform=microsoft_teams`. This first stage stores raw messages only; it does not generate summaries or MoM.

The redirect URI must match exactly in both `.env` and the Entra app registration. Required delegated Graph permissions are `User.Read`, `Team.ReadBasic.All`, `Channel.ReadBasic.All`, and `ChannelMessage.Read.All`; a tenant admin may need to grant consent. The Supabase OAuth-state and Microsoft Teams tables are created by the latest `supabase/schema.sql`.

### Google Drive

Enable the Google Drive API in Google Cloud Console, configure the OAuth consent screen, and add your Google account as a test user while the app is in testing. Create a **Web application** OAuth client and add this exact authorized redirect URI:

```text
http://localhost:3000/api/google-drive/auth/callback
```

Set `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, and `GOOGLE_DRIVE_REDIRECT_URI` in the root `.env`. Keep the client secret server-side. The integration requests read-only Drive access and stores its refresh token encrypted using `SOURCE_CREDENTIALS_KEY` (or the configured Supabase secret key). The Analyzer lists supported files and imports the selected file; supported types are Google Docs (exported as PDF), PDF, DOCX, TXT, and MD, up to 50 MB. Apply the latest `supabase/schema.sql` and restart the backend after configuring the OAuth client.

### Meeting Management and Google Meet

Apply the latest `supabase/schema.sql` to create the profiles, meetings, participants, notifications, reminder, and shared-calendar tables and their transaction functions. Enable the Google Calendar API in Google Cloud Console. A Web OAuth client may be used for this integration; add the exact `GOOGLE_MEET_REDIRECT_URI` as an authorized redirect URI:

```text
http://localhost:3000/api/meetings/calendar/auth/callback
```

Set `GOOGLE_MEET_CLIENT_ID`, `GOOGLE_MEET_CLIENT_SECRET`, and `GOOGLE_MEET_REDIRECT_URI` in the root `.env`. Add the Google account that owns the shared workspace calendar to `MEETING_ADMIN_EMAILS` (comma-separated Supabase Auth email addresses). Only those admins can connect or disconnect the shared calendar. An admin connects it from the Meeting Management page. Keep Google credentials and encrypted OAuth tokens on the backend; `SOURCE_CREDENTIALS_KEY` (or the configured Supabase secret key) must remain stable.

Calendar events are created on the connected shared account with Google Meet conference data. Google Calendar sends guest invitations and calendar email reminders; the backend also creates in-app reminders at four days, one day, 30 minutes, and meeting start. The FastAPI reminder worker processes due reminders using the database transaction function, so duplicate worker runs do not duplicate notifications. `MEETING_REMINDER_POLL_SECONDS` controls the polling interval.

The same schema migration creates the public `profile-photos` Supabase Storage bucket. Users can upload JPG, PNG, or WebP profile photos up to 5 MB from the Profile page; uploads are validated and written by the authenticated backend, then the resulting public URL is saved to `profiles.profile_photo_url`. Reapply the latest `supabase/schema.sql` if the bucket does not exist.

### Global search

The navbar search and Search page return matching workspace pages, documents, and meetings. Document results combine title/source matching with semantic document search. Meeting results are limited to meetings organized by or inviting the signed-in user. If Supabase metadata queries or semantic retrieval are unavailable, the endpoint still returns accessible results from working categories and includes warnings; check the response and backend logs for the affected category.

### Hugging Face and existing documents

After applying the latest schema and setting `HF_TOKEN`, re-embed stored document chunks once. Stop the running backend first, then run this from the repository root:

```powershell
.\.venv\Scripts\python.exe backend\reindex_embeddings.py
```

The script processes existing chunks in batches and updates only `embedding_hf`. It is safe to rerun if interrupted, but each run makes billable Inference Provider requests. Choose `EMBEDDING_PROVIDER=huggingface` for new uploads, knowledge-source syncs, and retrieval to use those vectors.

### Digital PDF extractor

The **Ekstraksi PDF** page uses `pdfplumber` to read selectable text only. It does not run OCR, so scanned PDFs without a text layer are rejected. Upload stores the extracted text without making an embedding request. Summary and question-answer calls try `HF_CHAT_MODEL` first, then automatically fall back to `OPENAI_MODEL` when Hugging Face fails and `OPENAI_API_KEY` is configured; the response and UI indicate when the fallback was used. OpenAI fallback requests may incur OpenAI API charges. HTTP 402 from Hugging Face means Inference Providers requires billing or available credits; check account billing/provider access and make sure `HF_TOKEN` has Inference Providers permission.

## Run

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

The health check is available at `http://127.0.0.1:8000/health`. Next.js forwards chat, document, upload, search, and analysis requests to this service when `LANGGRAPH_API_URL=http://127.0.0.1:8000` is set in `.env`.

Uploaded PDF, DOCX, TXT, and MD files are extracted, split into chunks, embedded with the configured provider, and stored in the private Supabase Storage bucket and `document_chunks` table. Outline documents are stored as text records with no storage object. Chat retrieves chunks using the RPC for the selected embedding provider. The dedicated PDF extractor stores text chunks without embeddings, so those files are available for its direct Q&A and summary features but not global vector search.