# Pyrahash staff digital name cards

Each staff member gets one QR code. Scanning it opens a mobile-friendly name card in the browser. No app or sign-in is needed. On the card, visitors can:

- **Save contact**: downloads a `.vcf` file. This works for everyone.
- **Add to Wallet**: saves a Google Wallet Generic pass. This is optional. Until Google approves publishing access, it only works for accounts allowed to receive passes (see [Demo mode](#demo-mode)).
- **Visit Pyrahash**: opens the company website.

Admins manage everything from a Google Sheet. A **Wallet** menu in the sheet creates and updates the passes.

## Files

| File | Purpose |
| --- | --- |
| `Code.gs` | Apps Script. It serves the web app (`doGet`), adds the sheet menu, creates and patches Wallet passes, signs JWTs and gets OAuth tokens. |
| `web/card/index.html` | Card page for hosting on pyrahash.com (fetches JSON from Apps Script). |
| `Card.html` | Card page template (mobile-first, light and dark mode, no frameworks). |
| `appsscript.json` | Manifest with the OAuth scopes and web app settings (runs as the owner, open to anyone). |
| `.claspignore` | Optional. Limits what [`clasp`](https://github.com/google/clasp) pushes. |

## How it works

```
Google Sheet (Employees tab)
   │  rows
   ▼
Apps Script ──doGet(?card=slug)──► Card page (HTML) ──► .vcf download
   │                                   └──► "Add to Wallet" (Wallet Save Link from the sheet)
   │  Wallet menu
   ▼
Google Wallet API: genericClass (once), then genericObject POST (insert) / PATCH (update)
```

1. **Generate Wallet Links** inserts a `genericObject` through the REST API for each row that has no `Wallet Object ID`. It then signs a save JWT that references **only the object ID** and writes the following to the sheet: `Wallet Object ID`, `Wallet Save Link` (`https://pay.google.com/gp/v/save/<JWT>`) and `Last Updated`.
2. **Update Wallet Passes** PATCHes every row that has a `Wallet Object ID` with that row's current details. Passes people have already saved update automatically.

---

## Setup checklist

### 1. Google Sheet

- [ ] Create a Google Sheet and open **Extensions › Apps Script**.
- [ ] Copy `Code.gs` into the editor. Add an HTML file named `Card` and paste in `Card.html`.
- [ ] In **Project Settings**, tick **Show "appsscript.json" manifest file in editor**. Replace the manifest with `appsscript.json`.
      Set `timeZone` to your office time zone (for example `Asia/Hong_Kong`).
- [ ] Reload the sheet. A **Wallet** menu appears. Run **Wallet › Set up sheet tabs** and approve the permissions when asked.
      This creates the `Employees` tab with these columns, in this order:

      Employee ID | Card Slug | Full Name | Job Title | Department | Phone | Email | Website / Profile URL | Photo URL | Wallet Object ID | Wallet Save Link | Last Updated

      It also creates a `Logs` tab and sets the **Phone** column to plain text, so leading `+` and `0` are kept.
- [ ] Fill in the staff rows. Leave the last three columns empty, because the script fills them in.
  - **Card Slug** may only contain `a-z`, `0-9` and single hyphens, for example `jane-doe`. Each slug must be unique.
  - **Photo URL** must be a public `https://` image URL. Google's servers fetch it for the pass.

  - **WhatsApp** (optional column, added by **Set up sheet tabs**): a WhatsApp number such as `012-345 6789` or `+60 12-345 6789`, or `same` (any text without digits) to use the Phone number. Any header containing "WhatsApp" works, such as "WhatsApp Number". When filled, the card shows a **Chat on WhatsApp** button that opens a chat with a pre-filled greeting, and the Wallet pass gets a WhatsApp link. Leave it empty to hide WhatsApp.
> Alternative: use `clasp push` from this folder. `.claspignore` limits the push to the three project files.

### 2. Google Cloud project and service account

- [ ] In the [Google Cloud console](https://console.cloud.google.com/), create a project (or pick an existing one).
- [ ] Open **APIs & Services › Library** and enable the **Google Wallet API**.
- [ ] Open **IAM & Admin › Service accounts** and create a service account, for example `wallet-issuer`.
      **No IAM role is needed** for Wallet. Access is granted in the Google Pay & Wallet Console instead (step 3). This follows Google's Wallet [prerequisites guide](https://developers.google.com/wallet/generic/web/prerequisites).
- [ ] Open the service account and go to **Keys › Add key › Create new key › JSON**. Download the file and keep it private.
      If key creation is blocked, your organisation policy `iam.disableServiceAccountKeyCreation` is on. An organisation admin must allow it for this project.

### 3. Google Pay & Wallet issuer account

- [ ] Open the [Google Pay & Wallet Console](https://pay.google.com/business/console) and create (or select) the Pyrahash business profile.
- [ ] Open **Google Wallet API** and copy the **Issuer ID**, which is a long number.
- [ ] Open **Users › Invite a user**, add the **service account email** (`…@….iam.gserviceaccount.com`) and give it **Developer** access.
      This lets the service account create classes and objects.
- [ ] Add every Google account you want to test with as a user too. In demo mode, only these accounts can save passes.
- [ ] When you're ready for all staff and visitors, go to **Google Wallet API** and **request publishing access**. You need a complete business profile, and Google may ask to review a sample pass. Until approval, the issuer stays in [demo mode](#demo-mode).

### 4. Script Properties

In Apps Script, open **Project Settings › Script Properties › Add script property**:

| Property | Required | Example | Notes |
| --- | --- | --- | --- |
| `SERVICE_ACCOUNT_KEY` | Wallet | `{ "type": "service_account", … }` | Paste the **whole** JSON key file. It is stored only here, never in the sheet or the code. |
| `ISSUER_ID` | Wallet | `3388000000012345678` | From the Pay & Wallet Console. |
| `BASE_URL` | Wallet | `https://pyrahash.com/card` or the web app `/exec` URL | Public URL of the card page. The QR value becomes `BASE_URL?card=<slug>`. |
| `COMPANY_NAME` | Optional | `Pyrahash` | Defaults to `Pyrahash`. |
| `LOGO_URL` | Recommended | `https://pyrahash.com/logo.png` | Must use `https://`. Used on the card page and the pass. |
| `CARD_COLOR` | Optional | `#1a73e8` | Hex colour. Defaults to `#1a73e8`. Text on it switches between black and white for contrast. |
| `COMPANY_URL` | Optional | `https://pyrahash.com` | Target of the "Visit Pyrahash" button. |
| `CLASS_SUFFIX` | Optional | `pyrahash_staff_card` | The pass class ID is `<ISSUER_ID>.<CLASS_SUFFIX>`. |
| `DEFAULT_COUNTRY_CODE` | Optional | `60` | Country code added to WhatsApp numbers that start with 0 (60 = Malaysia). Defaults to `60`. |

The card page reads only the non-secret properties. The service account key is read only by the Wallet menu actions.

### 5. Deploy the web app and set BASE_URL

- [ ] Click **Deploy › New deployment** and choose the **Web app** type.
  - **Execute as:** Me (the script owner)
  - **Who has access:** Anyone

  The manifest already sets these values (`USER_DEPLOYING`, `ANYONE_ANONYMOUS`).
- [ ] Copy the web app URL. It ends in `/exec`.
- [ ] Set `BASE_URL`:
  - **Simplest:** use the `/exec` URL directly. Cards are then at `https://script.google.com/macros/s/…/exec?card=jane-doe`.
  - **Custom domain:** set `BASE_URL` to `https://pyrahash.com/card`. On the Pyrahash website, redirect `/card?card=<slug>` to `<exec URL>?card=<slug>` and **keep the query string**.
- [ ] After code changes, use **Deploy › Manage deployments › Edit › New version** to keep the same URL. A new deployment gets a new URL and breaks the printed QR codes.

Visit `<exec URL>?card=does-not-exist` to check that the "Card not found" page appears.

### 5b. Host the card page on pyrahash.com (recommended)

Visitors then see `pyrahash.com` in the address bar, with no Google banner. The page on your site fetches the card data from Apps Script (`?format=json`) and draws the card itself.

```
Visitor scans QR ─► https://pyrahash.com/card?card=jane-doe   (web/card/index.html on your site)
                         │ fetch
                         ▼
                    <exec URL>?format=json&card=jane-doe       (Apps Script reads the sheet)
```

- [ ] Open `web/card/index.html` and set `API_URL` to your `/exec` URL. Don't use the `/dev` URL: only you can open it.
- [ ] Add the file to your website so it is served at `/card`:
  - **Vite / React / Vue project:** copy it to `public/card/index.html`. Vite copies `public/` as is, so after the next build and deploy it is live at `https://pyrahash.com/card/`.
  - **Plain static site or cPanel:** upload it as `card/index.html` in the site root.
- [ ] Set the Script Property `BASE_URL` to `https://pyrahash.com/card`, so Wallet passes link to your domain.
- [ ] Test `https://pyrahash.com/card?card=test-user` on your phone.

The page is standalone. It is not a section of your landing page, and it doesn't need the site's framework. The "Visit PyraHash" button links back to the landing page. If you want prettier links such as `/card/jane-doe`, add a rewrite from `/card/*` to `/card/index.html` on your host. The page reads the slug from either form.

**Show QR code (in person).** The card has a **Show QR code** button that opens a large QR code for a client to scan:
- **Contact** (default): the QR holds the contact details themselves (vCard). The client's phone camera offers **Add to contacts** straight away, with no web page or internet needed.
- **Card link**: the QR opens this online card instead.

The QR library (qrcode-generator 1.4.4, MIT) is bundled inside `index.html`, so the page still makes no third-party requests.

Sheet edits show up on the card immediately. Only code changes in Apps Script need a new deployment version, and the `/exec` URL stays the same.

### 6. QR codes (one per slug)

Each QR code points to `BASE_URL?card=<slug>`. The Wallet pass shows the same URL as its QR code, so staff can also show their pass to be scanned.

Generate the codes with any QR tool. For example, use [`qrencode`](https://fukuchi.org/works/qrencode/) on Linux or macOS:

```bash
qrencode -o jane-doe.png -s 10 -m 2 "https://pyrahash.com/card?card=jane-doe"
```

You can export the **Card Slug** column to `slugs.txt` (one slug per line) to make all the codes at once:

```bash
while read -r slug; do qrencode -o "qr/$slug.png" -s 10 -m 2 "https://pyrahash.com/card?card=$slug"; done < slugs.txt
```

Test each printed code with a phone camera before you hand it out.

### 7. Generate the passes

- [ ] Run **Wallet › Generate Wallet Links**. The first run also creates the pass class.
- [ ] Check the `Logs` tab for any rows marked `ERROR`. Fix them and run the action again. Rows that already have an object ID are skipped.
- [ ] After you edit staff details, run **Wallet › Update Wallet Passes**.

---

## Behaviour details

- **Blank rows** (no ID, slug or name) are skipped.
- **Errors are logged per row** in the `Logs` tab (timestamp, action, row, employee ID, status, message). The job then moves on to the next row.
- **Time limit:** a run stops itself after about 4.5 minutes, safely inside Apps Script's roughly 6-minute limit. It saves its position and asks you to run it again to continue. Each row is written as soon as it is done. **Wallet › Reset job progress** clears the saved position.
- **Locking:** only one Wallet job runs at a time.
- **Retries:** HTTP 429 and 5xx responses from the Wallet API are retried up to 3 times with backoff. OAuth tokens are cached for about 55 minutes.
- **Object IDs** are `<ISSUER_ID>.staff_<Employee ID>`. Characters other than `A-Z a-z 0-9 . _ -` become `_`. If an insert returns 409 (the object already exists, for example because the ID cell was cleared), the object is PATCHed and the links are written back.
- **Changing a slug** updates the QR code on the pass the next time you run **Update Wallet Passes**. QR codes that are already printed keep the old slug.

## Security

- The service account key lives only in Script Properties. It is never written to the sheet, the logs or the code, and error messages never include it.
- `card` is validated against `^[a-z0-9]+(-[a-z0-9]+)*$` (maximum 64 characters) before any lookup. Input is lowercased first.
- The card page reads only the `Employees` tab and only the row that matches the slug. The template receives only the fields it displays. The Wallet Object ID is never sent. The Wallet Save Link is used only as the target of the Add to Wallet button, and only if it starts with `https://pay.google.com/gp/v/save/`.
- All sheet values are printed with `<?= ?>`, which HtmlService escapes for the surrounding context. URLs are also restricted to `https://` (photo, logo), `http(s)://` (website), `tel:` and `mailto:`. The two colour values are the only unescaped prints, and both are checked against a strict hex pattern first.
- The vCard text is passed through an escaped `data-` attribute, not through inline script.
- Anyone with the card URL can see the details on that card. Only put information on the sheet that you are happy to share publicly.

## Demo mode

Until Google approves publishing access, the issuer is in **demo mode**. In demo mode, only accounts added as users of the issuer account (admins, developers and test users) can save passes. Other accounts get an error from Google Wallet. A demo pass may also be labelled as a test pass.

The card page and vCard work without Wallet. When a row has no Wallet Save Link (for example before you run Generate Wallet Links), the Add to Wallet button is not shown.

## Assumptions and notes

These choices were checked against the Google Wallet REST reference. Confirm them against the current docs if Google changes the API.

1. **Logo, colour and barcode are set on the object, not the class.** The spec asked for a class "with logo, colour, and `QR_CODE` barcode". However, the Generic pass `GenericClass` resource has no `logo`, `hexBackgroundColor` or `barcode` fields. Those fields belong to `GenericObject`. The class is therefore created with just `id` and `multipleDevicesAndHoldersAllowedStatus`. Each object carries `cardTitle` (company name), `header` (full name), `subheader` (job title), `logo`, `hexBackgroundColor`, a `barcode` of type `QR_CODE`, `textModulesData` (department, phone, email), `linksModuleData` (call, email, website, card page) and `imageModulesData` (photo, if set).
2. **`MULTIPLE_HOLDERS`.** The save link appears on a public card page. This class setting lets more than one Google account save the same object, so a visitor saving a card cannot lock the staff member out of their own pass. If you only want staff to save passes, remove the Add to Wallet button from `Card.html` and share each save link with the staff member privately. If the class already exists, the script does not change it.
3. **QR URL format.** The spec mentions both `BASE_URL/<slug>` and `BASE_URL?card=<slug>`. Passes and QR codes use `BASE_URL?card=<slug>`, which works with the web app directly. `doGet` also accepts `<exec URL>/<slug>` (through `e.pathInfo`).
4. **Clearing fields with PATCH.** PATCH replaces only the fields it sends. The text, link and image module arrays are always sent, even when empty, so removed details disappear from the pass. Clearing **Job Title** removes it from the card page, but the pass keeps its old `subheader` (an empty LocalizedString is not sent). Put a placeholder in the cell if you need to change it.
5. **Save JWT** fields: `iss` (service account email), `aud: "google"`, `typ: "savetowallet"`, `iat`, and `payload.genericObjects: [{ id }]`. `origins` is left out because the pass is saved through a link, not the JavaScript button.
6. **vCard download.** The page builds the `.vcf` as a Blob in the browser. Apps Script serves pages inside a sandboxed iframe, and some browsers (notably some iOS versions) block downloads there. A "Get the contact file" fallback link therefore appears after you tap the button. It downloads the same vCard from `?card=<slug>&format=vcf`. The vCard keeps the full name exactly as typed (no family/given split), so Chinese, Malay and Indian names display correctly on every phone.
7. **"Add to Wallet" button style.** For production, Google's [brand guidelines](https://developers.google.com/wallet/generic/resources/brand-guidelines) require the official "Add to Google Wallet" button artwork. The page uses a plain labelled button. Swap in the official asset before launch.
8. **Apps Script banner.** Web apps owned by a personal Gmail account show a banner saying an Apps Script user created the page. Deploying from a Google Workspace account removes it.
9. **Scope.** The manifest uses the full `spreadsheets` scope so the web app can read the bound sheet reliably. The Wallet scope (`wallet_object.issuer`) belongs to the service account token, not the manifest.

---

## Test plan

1. **Add a test row.** Use Employee ID `T001`, Card Slug `test-user`, your name, a job title, a department, a phone number in `+852 …` format, your email, a website and an `https://` photo URL.
2. **Generate its pass.** Run **Wallet › Generate Wallet Links**. Check that the row now has a `Wallet Object ID` (`<ISSUER_ID>.staff_T001`), a `Wallet Save Link` starting with `https://pay.google.com/gp/v/save/`, and a `Last Updated` time. Check that the `Logs` tab shows `OK`.
3. **Scan its QR code.** Generate a QR code for `BASE_URL?card=test-user` and scan it with a phone camera.
4. **Check the card page.**
   - The logo, company name, photo, name, title and department are shown.
   - Tapping the phone number starts a call, tapping the email address opens a new email, and tapping the website opens it.
   - Switch the phone to dark mode and check the page is still readable.
   - On a laptop, press Tab through the page. Every link and button should show a visible focus ring.
   - Open `?card=nope` and `?card=<script>` and check that both show "Card not found".
5. **Save the vCard.** Tap **Save contact**. Open the `.vcf` and check the name, company, department, title, phone, email and website. If the download is blocked, use the fallback link.
6. **Add the pass to a test account.** Sign in with an account added to the issuer in step 3 of the setup. Tap **Add to Wallet** and save the pass. Check the QR code on the pass opens the card page.
7. **Edit the row and confirm the update.** Change the Job Title and Phone, then run **Wallet › Update Wallet Passes**. Check that `Last Updated` changes, the `Logs` tab shows `OK`, and the card page shows the new details straight away. The saved pass should update within a few minutes; pull to refresh in Google Wallet if needed.
8. **Failure handling (optional).** Put an invalid slug such as `Bad Slug!` on a second row and run **Generate Wallet Links**. That row should be logged as an `ERROR` while the other rows still process.
