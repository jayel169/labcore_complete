# LabCore hosted PostgreSQL deployment

Local development remains SQLite by default. The backend selects PostgreSQL
only when `DATABASE_URL` is present; the Render blueprint provisions a managed
PostgreSQL database and wires its connection string into the web service.
Database calls in the API are asynchronous for both engines. Do not share a
SQLite file across service instances.

## Not approved for real patient data

The required hosting region, data processor, privacy/security controls, backup
region and organizational approvals have **not** been confirmed. Frankfurt in
`render.yaml` is only a test placeholder, not a residency recommendation or
approval. Keep hosted testing synthetic until the organization explicitly
approves those decisions. Do not migrate, seed, or upload any existing/local
patient data; the initial hosted PostgreSQL database must remain empty apart
from schema and a separately bootstrapped administrator.

This is deployment preparation, not authorization for production clinical use.
Do not consider production fully approved.

## What `render.yaml` prepares

- One Node web service and one managed PostgreSQL database in the same
  placeholder region, with `DATABASE_URL` wired by Render.
- One app instance; the database is shared server-side rather than a file on an
  app disk. No existing SQLite data is imported.
- A generated JWT secret, database schema initialization/migrations, and a
  PostgreSQL-backed `/api/health` readiness check.
- TLS for the Render internal database connection (`PGSSL=require`); Render's
  internal certificates are self-signed, so TLS is encrypted but certificate
  identity is not verified on this private network. For providers with a
  publicly trusted certificate chain, omit `PGSSL=require` to validate it.
- Required daily S3-compatible backups in hosted production: PostgreSQL is
  exported as a logical JSON snapshot; local SQLite retains its snapshot path.

Review the region and service/database plans before creating anything. Select
matching, explicitly approved regions for the app, database and backup bucket.
No hosting resources are created by this repository change.

## Separate Vercel frontend

The Vercel project builds only the root HTML pages and `shared/` frontend
assets into `dist/`; it does not publish the backend source or local database.
Configure the project to use the repository root and set the Vercel build
environment variable `LABCORE_API_BASE` to the Render backend API URL, for
example `https://your-labcore-api.onrender.com/api`. The build rejects missing,
non-HTTPS, or malformed values. Set it for production and preview environments
to the corresponding approved backend, rather than pointing previews at
production data.

After the first Vercel deployment, set Render's `CORS_ORIGIN` secret to the
exact Vercel site origin (scheme and host only, such as
`https://your-labcore.vercel.app`; no `/api` path). For a Vercel preview domain,
add that exact origin only if the preview is authorized to access the selected
backend. The frontend calls Render directly; do not add database credentials
or other server secrets to Vercel frontend variables. Vercel deployments remain
subject to the region and real-data approvals above.

To verify the static build locally without using real records:

```powershell
$env:LABCORE_API_BASE = 'https://your-labcore-api.onrender.com/api'
npm run build:vercel
```

The generated `dist/` directory is a build artifact and should not be committed.

## Deployment checklist

1. Obtain written approval for application/database/backup regions, the
   processor, data flows, access controls, retention and incident response.
   Until approval, use synthetic records only and do not accept real patient
   data.
2. Change both `region` entries in `render.yaml` from the Frankfurt placeholder
   only after the organization chooses and approves a region. Confirm the
   selected plans and PostgreSQL retention/backups with the provider.
3. Create the project from `render.yaml`. Keep one app instance unless
   concurrency/load and operational controls have been reviewed. Confirm the
   managed PostgreSQL service is provisioned and `DATABASE_URL` is present.
4. Configure a private S3-compatible bucket in an approved region and set
   `BACKUP_S3_BUCKET`, `AWS_REGION`, and credentials as provider-managed
   secrets. Never put credentials in source control. Limit the identity to
   `s3:PutObject` on the backup prefix and `s3:ListBucket`/`s3:GetObject` on
   that prefix; require TLS and encryption at rest. Production startup refuses
   to start until the bucket and region are configured.
5. Deploy the frontend to Vercel with `LABCORE_API_BASE` pointing to the
   Render service. Set `CORS_ORIGIN` on Render to the final Vercel origin.
6. Confirm a healthy `/api/health` response reporting `database: postgresql`,
   and a `[backup] verified and uploaded` log entry. Test `backup:verify` before
   considering recovery procedures ready, then confirm the frontend can reach
   `/api/health`.
7. Bootstrap one unique administrator into the **empty hosted database** from
   the provider's private service shell. Supply `ADMIN_EMAIL`, `ADMIN_NAME`,
   and a private `ADMIN_PIN` as temporary provider environment variables, then
   run:

   ```sh
   npm run admin:bootstrap --prefix labcore-backend
   ```

   Remove those values immediately. Bootstrap refuses to run when any staff
   account exists. Never run the demo `seed` command against PostgreSQL.
8. Sign in with the setup PIN, enroll a strong password and authenticator app,
   and verify another backup. Continue with synthetic data until every
   organizational and regional approval is complete.

## Backup and restore verification

In hosted production the scheduler requires backup settings, makes an initial
backup after startup and then
one daily at 02:00 UTC, retrying failures up to three times. PostgreSQL exports
all public tables in a consistent read-only transaction and uploads a JSON
logical snapshot with S3 server-side encryption. SQLite uses `VACUUM INTO` and
checks integrity and required tables. This does not replace provider-managed
database backups, monitoring, retention review or a tested recovery plan.

Run verification from the provider service shell:

```sh
npm run backup:verify --prefix labcore-backend
```

Verification downloads the latest object and checks required table content
without modifying the live database. It does **not** restore a PostgreSQL
snapshot. Define and test a provider-approved restore process, permissions and
point-in-time recovery before production use; never restore over a live service.

## Local SQLite / PostgreSQL development

Copy `labcore-backend/.env.example` to `labcore-backend/.env` (the root
example is a reference template) or export the settings in your shell. Leave
`DATABASE_URL` blank to use the existing local SQLite database and `DB_PATH`.
To deliberately test PostgreSQL, set `DATABASE_URL` for a disposable,
non-clinical database; use `PGSSL=disable` only for a trusted local server.
There is no SQLite-to-PostgreSQL patient-data migration command.

Backups are disabled locally unless `BACKUP_S3_BUCKET` and `AWS_REGION` are
configured. Use synthetic data when testing remote backup scripts.

## QC and specimen workflow

The Laboratory navigation now includes **Quality Control** and **Specimen
Tracking**. QC controls are configured by panel/order name, analyte/result
field, instrument, control lot and level, using limits supplied by the
laboratory. Recording a QC measurement stores the value and calculates Pass or
Fail from those configured limits. Do not use patient reference ranges as QC
limits.

Once a control is active, validation of matching results is held unless each
active control level for that panel, analyte and instrument has a passing run
on the current Africa/Accra date. A failed latest run or expired control also
holds validation. Preliminary entry is unaffected; results for tests with no
configured QC control retain their existing behavior. Enter the instrument in
the result-entry panel so the backend can apply the matching QC scope. Replace
control lots by adding the new lot and deactivating the old one when it is no
longer in use.

Specimens move through **Received → Processing → Completed → Dispatched**;
specimens can be rejected from Received or Processing with a required reason.
Each status change records its time, staff member and note in append-only
history. Existing specimen records receive an initial Received history event
when the updated backend starts.

This initial QC implementation evaluates configured numeric lower/upper
limits only. It does not implement Westgard rules, peer-group statistics,
automatic result release, or replacement for the laboratory's approved QC
policy and supervisory review.

## Critical-result follow-up, turnaround monitoring, and sign-in

Critical results flagged `LL` or `HH` create an in-app follow-up alert when a
laboratory order is validated. Alerts are assigned to the active requesting
doctor when one is recorded; otherwise, laboratory or admin staff must assign
one. Laboratory/admin staff record clinician contact, and only the assigned
doctor can acknowledge the alert. The 15-minute overdue indicator is an
in-app escalation aid only: no SMS or email provider is configured, so staff
must continue using the facility's approved critical-result communication
procedure.

Administrators configure turnaround targets per panel in the Turnaround
Monitor. No targets or clinical service-level limits are assumed by the app.
Only orders with a recorded specimen-receipt timestamp are included; define
and review targets with the laboratory before relying on the dashboard.

Staff sign in using a password and an authenticator-app code. A temporary
setup PIN is accepted only to enroll; administrators can reset an account to
require enrollment again. MFA secrets are encrypted using a key derived from
`JWT_SECRET`, so preserve that secret securely and consistently across
restarts. Rotating `JWT_SECRET` makes previously stored MFA secrets
undecryptable and requires affected staff to be reset and re-enrolled.
