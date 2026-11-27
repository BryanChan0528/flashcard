/**
 * Pyrahash staff digital name cards
 * ---------------------------------------------------------------------------
 * Bound to the Google Sheet that holds the `Employees` tab. This script:
 *   1. Serves each staff member's card page as a web app (doGet).
 *   2. Creates Google Wallet Generic pass objects and save links
 *      (menu: Wallet > Generate Wallet Links).
 *   3. PATCHes existing pass objects when details change
 *      (menu: Wallet > Update Wallet Passes).
 *
 * All secrets and settings live in Script Properties (see README.md).
 * Nothing secret is written to the sheet or to this file.
 */

/* =========================================================================
 * 1. CONSTANTS
 * ========================================================================= */

const SHEET_EMPLOYEES = 'Employees';
const SHEET_LOGS = 'Logs';

/** Column headers, in the order the Employees tab uses. Columns are looked up
 *  by header text, so moving a column does not break anything. */
const COL = {
  ID: 'Employee ID',
  SLUG: 'Card Slug',
  NAME: 'Full Name',
  TITLE: 'Job Title',
  DEPT: 'Department',
  PHONE: 'Phone',
  EMAIL: 'Email',
  WEBSITE: 'Website / Profile URL',
  PHOTO: 'Photo URL',
  OBJECT_ID: 'Wallet Object ID',
  SAVE_LINK: 'Wallet Save Link',
  UPDATED: 'Last Updated',
  WHATSAPP: 'WhatsApp',
};
const HEADERS = [
  COL.ID, COL.SLUG, COL.NAME, COL.TITLE, COL.DEPT, COL.PHONE, COL.EMAIL,
  COL.WEBSITE, COL.PHOTO, COL.OBJECT_ID, COL.SAVE_LINK, COL.UPDATED,
];
/** Optional columns: used when present, never required. Add them to the
 *  right of Last Updated (Wallet > Set up sheet tabs does this for you). */
const OPTIONAL_HEADERS = [COL.WHATSAPP];
const LOG_HEADERS = ['Timestamp', 'Action', 'Row', 'Employee ID', 'Status', 'Message'];

/** Google Wallet / OAuth endpoints (from the Google Wallet REST reference). */
const WALLET_SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const WALLET_API = 'https://walletobjects.googleapis.com/walletobjects/v1';
const GENERIC_CLASS_URL = WALLET_API + '/genericClass';
const GENERIC_OBJECT_URL = WALLET_API + '/genericObject';
const SAVE_URL_PREFIX = 'https://pay.google.com/gp/v/save/';

/** Default class suffix. The full class ID is `<ISSUER_ID>.<suffix>`. */
const DEFAULT_CLASS_SUFFIX = 'pyrahash_staff_card';

/** Apps Script stops a run at about 6 minutes. Stop earlier so the sheet is
 *  left in a clean state and the user can re-run to continue. */
const MAX_RUNTIME_MS = 4.5 * 60 * 1000;

/** Card slugs: lowercase letters, digits and single hyphens, max 64 chars. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX_LENGTH = 64;

/* =========================================================================
 * 2. CONFIGURATION (Script Properties)
 * ========================================================================= */

/**
 * Settings needed by the card page. Safe to call from doGet: it never reads
 * the service account key.
 */
function getConfig_() {
  const p = PropertiesService.getScriptProperties().getProperties();
  return {
    companyName: clean_(p.COMPANY_NAME) || 'Pyrahash',
    logoUrl: safeHttpsUrl_(p.LOGO_URL),
    cardColor: normaliseHex_(p.CARD_COLOR) || '#1a73e8',
    baseUrl: normaliseBaseUrl_(p.BASE_URL),
    companyUrl: safeWebUrl_(p.COMPANY_URL) || 'https://pyrahash.com',
    countryCode: /^\d{1,3}$/.test(clean_(p.DEFAULT_COUNTRY_CODE)) ? clean_(p.DEFAULT_COUNTRY_CODE) : '60',
    issuerId: clean_(p.ISSUER_ID),
    classSuffix: clean_(p.CLASS_SUFFIX) || DEFAULT_CLASS_SUFFIX,
  };
}

/**
 * Settings needed by the Wallet menu actions. Throws a clear error (without
 * echoing any secret) when something is missing.
 */
function getWalletConfig_() {
  const cfg = getConfig_();
  const problems = [];

  if (!/^\d+$/.test(cfg.issuerId)) problems.push('ISSUER_ID is missing or not numeric.');
  if (!cfg.baseUrl) problems.push('BASE_URL is missing or not a valid URL.');
  if (!/^[A-Za-z0-9._-]+$/.test(cfg.classSuffix)) {
    problems.push('CLASS_SUFFIX may only contain letters, digits, ".", "_" and "-".');
  }

  let key = null;
  const rawKey = PropertiesService.getScriptProperties().getProperty('SERVICE_ACCOUNT_KEY');
  if (!rawKey) {
    problems.push('SERVICE_ACCOUNT_KEY is missing.');
  } else {
    try {
      key = JSON.parse(rawKey);
    } catch (err) {
      problems.push('SERVICE_ACCOUNT_KEY is not valid JSON. Paste the whole key file.');
    }
    if (key && (!key.client_email || !key.private_key)) {
      problems.push('SERVICE_ACCOUNT_KEY must contain client_email and private_key.');
    }
  }

  if (problems.length) {
    throw new Error('Configuration problem:\n- ' + problems.join('\n- ') +
      '\n\nSet these in Project Settings > Script Properties.');
  }

  cfg.clientEmail = key.client_email;
  cfg.privateKey = key.private_key;
  cfg.classId = cfg.issuerId + '.' + cfg.classSuffix;
  return cfg;
}

/* =========================================================================
 * 3. SHEET MENU
 * ========================================================================= */

/** Adds the Wallet menu when the spreadsheet opens. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Wallet')
    .addItem('Generate Wallet Links', 'generateWalletLinks')
    .addItem('Update Wallet Passes', 'updateWalletPasses')
    .addSeparator()
    .addItem('Set up sheet tabs', 'setUpSheets')
    .addItem('Reset job progress', 'resetJobProgress')
    .addToUi();
}

/** Creates the Employees and Logs tabs with headers if they are missing. */
function setUpSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let emp = ss.getSheetByName(SHEET_EMPLOYEES);
  if (!emp) emp = ss.insertSheet(SHEET_EMPLOYEES);
  if (emp.getLastRow() === 0) {
    emp.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    emp.setFrozenRows(1);
    // Keep phone numbers as text so leading "+" and "0" survive.
    emp.getRange(2, HEADERS.indexOf(COL.PHONE) + 1, emp.getMaxRows() - 1, 1).setNumberFormat('@');
  }

  // Add any optional column that is missing (for example WhatsApp) at the end.
  const header = emp.getRange(1, 1, 1, Math.max(emp.getLastColumn(), 1)).getValues()[0].map(headerKey_);
  OPTIONAL_HEADERS.forEach((h) => {
    if (header.indexOf(headerKey_(h)) !== -1) return;
    const col = emp.getLastColumn() + 1;
    emp.getRange(1, col).setValue(h).setFontWeight('bold');
    emp.getRange(2, col, emp.getMaxRows() - 1, 1).setNumberFormat('@');
    header.push(headerKey_(h));
  });

  getLogSheet_();
  SpreadsheetApp.getUi().alert('The Employees and Logs tabs are ready.');
}

/** Clears saved resume positions so the next run starts from row 2. */
function resetJobProgress() {
  const props = PropertiesService.getDocumentProperties();
  props.deleteProperty(cursorKey_('generate'));
  props.deleteProperty(cursorKey_('update'));
  SpreadsheetApp.getUi().alert('Job progress reset. The next run starts from the first row.');
}

/** Menu: insert pass objects for rows that have no Wallet Object ID yet. */
function generateWalletLinks() {
  runWalletJob_('generate');
}

/** Menu: PATCH pass objects for rows that already have a Wallet Object ID. */
function updateWalletPasses() {
  runWalletJob_('update');
}

/* =========================================================================
 * 4. WEB APP: CARD PAGE
 * ========================================================================= */

/**
 * Entry point for the web app.
 *   ?card=<slug>               -> HTML card page (served by Apps Script)
 *   ?card=<slug>&format=json   -> card data as JSON, used by the card page
 *                                 hosted on pyrahash.com (web/card/index.html)
 *   ?card=<slug>&format=vcf    -> .vcf download
 * `<web app URL>/<slug>` also works (Apps Script passes it as e.pathInfo).
 */
function doGet(e) {
  const params = (e && e.parameter) || {};
  const slug = parseSlug_(params.card || (e && e.pathInfo) || '');
  const cfg = getConfig_();
  const emp = slug ? findEmployeeBySlug_(slug) : null;

  if (params.format === 'json') {
    // Responses from ContentService are served from
    // script.googleusercontent.com with "Access-Control-Allow-Origin: *",
    // so the page on pyrahash.com can fetch this with a plain GET.
    return ContentService.createTextOutput(JSON.stringify(buildCardData_(emp, cfg)))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (emp && params.format === 'vcf') {
    return ContentService.createTextOutput(buildVCard_(emp, cfg.companyName))
      .setMimeType(ContentService.MimeType.VCARD)
      .downloadAsFile(emp.slug + '.vcf');
  }

  return renderCardPage_(emp, cfg);
}

/** Renders Card.html. Values are printed with escaping scriptlets. */
function renderCardPage_(emp, cfg) {
  const tpl = HtmlService.createTemplateFromFile('Card');
  tpl.d = buildCardData_(emp, cfg);
  const title = emp ? emp.fullName + ' | ' + cfg.companyName : 'Card not found | ' + cfg.companyName;
  return tpl.evaluate()
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/**
 * The public data for one card. This is the ONLY data that leaves the sheet:
 * it is used by both the Apps Script page and the JSON endpoint. URLs are
 * checked here so only http(s), tel: and mailto: links are returned. The
 * Wallet Object ID is never included.
 */
function buildCardData_(emp, cfg) {
  const d = {
    found: !!emp,
    companyName: cfg.companyName,
    companyUrl: cfg.companyUrl,
    logoUrl: cfg.logoUrl,
    accent: cfg.cardColor,
    onAccent: textColourFor_(cfg.cardColor),
  };

  if (emp) {
    const phoneHref = telHref_(emp.phone);
    const email = isEmail_(emp.email) ? emp.email : '';
    const website = safeWebUrl_(emp.website);
    const appUrl = ScriptApp.getService().getUrl() || '';

    d.name = emp.fullName;
    d.initials = initials_(emp.fullName);
    d.title = emp.jobTitle;
    d.department = emp.department;
    d.photoUrl = safeHttpsUrl_(emp.photoUrl);
    d.phone = phoneHref ? emp.phone : '';
    d.phoneHref = phoneHref;
    d.email = email;
    d.emailHref = email ? 'mailto:' + email : '';
    d.website = website;
    d.websiteLabel = website.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    d.whatsappHref = whatsAppHref_(emp, cfg, true);
    d.whatsapp = d.whatsappHref ? whatsAppNumber_(emp) : '';
    d.vcard = buildVCard_(emp, cfg.companyName);
    d.vcardFilename = emp.slug + '.vcf';
    d.vcardFallbackUrl = appUrl ? appUrl + '?card=' + encodeURIComponent(emp.slug) + '&format=vcf' : '';
    // Only accept genuine Google Wallet save links from the sheet.
    d.walletLink = emp.saveLink.indexOf(SAVE_URL_PREFIX) === 0 ? emp.saveLink : '';
  }
  return d;
}

/**
 * Returns the employee for a slug, or null. Reads only the Employees tab and
 * returns only card fields (no Wallet Object ID).
 */
function findEmployeeBySlug_(slug) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_EMPLOYEES);
  if (!sheet || sheet.getLastRow() < 2) return null;

  const values = sheet.getDataRange().getValues();
  const map = columnMap_(values[0]);
  for (let i = 1; i < values.length; i++) {
    const emp = rowToEmployee_(values[i], map);
    if (emp.fullName && parseSlug_(emp.slug) === slug) {
      emp.slug = slug;
      delete emp.objectId;
      return emp;
    }
  }
  return null;
}

/**
 * Builds a vCard 3.0 string. The page turns this into a .vcf file in the
 * browser; the ?format=vcf fallback serves the same text.
 */
function buildVCard_(emp, companyName) {
  const esc = (s) => String(s || '')
    .replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    // Whole name as the given name, family name left empty: Malaysian names
    // follow several orders (Chan Yung Her, Ahmad bin Ali, Ravi a/l Kumar),
    // and phones would reorder a split name as "given family". This way every
    // phone shows the name exactly as typed in the sheet.
    'N:;' + esc(emp.fullName) + ';;;',
    'FN:' + esc(emp.fullName),
    'ORG:' + esc(companyName) + (emp.department ? ';' + esc(emp.department) : ''),
  ];
  if (emp.jobTitle) lines.push('TITLE:' + esc(emp.jobTitle));
  if (telHref_(emp.phone)) lines.push('TEL;TYPE=WORK,VOICE:' + esc(emp.phone));
  if (isEmail_(emp.email)) lines.push('EMAIL;TYPE=INTERNET,WORK:' + esc(emp.email));
  const site = safeWebUrl_(emp.website);
  if (site) lines.push('URL:' + esc(site));
  lines.push('END:VCARD');
  return lines.join('\r\n') + '\r\n';
}

/* =========================================================================
 * 5. SHEET HELPERS
 * ========================================================================= */

/** Returns the Employees sheet and its column map, or throws. */
function getEmployeesSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_EMPLOYEES);
  if (!sheet) throw new Error('No "' + SHEET_EMPLOYEES + '" tab. Run Wallet > Set up sheet tabs.');
  const header = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  const map = columnMap_(header);
  const missing = HEADERS.filter((h) => map[headerKey_(h)] === undefined);
  if (missing.length) throw new Error('Employees tab is missing columns: ' + missing.join(', '));
  return { sheet: sheet, map: map };
}

/** Header text compared without case or extra spaces:
 *  "Whatsapp", "WHATSAPP " and "WhatsApp" are the same column. */
function headerKey_(h) {
  return String(h).replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Maps each header (see headerKey_) to a 0-based column index. */
function columnMap_(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const key = headerKey_(h);
    if (key && map[key] === undefined) map[key] = i;
  });
  return map;
}

/** Converts one sheet row into a plain employee object (trimmed strings). */
function rowToEmployee_(row, map) {
  const get = (h) => (map[headerKey_(h)] === undefined ? '' : clean_(row[map[headerKey_(h)]]));
  return {
    employeeId: get(COL.ID),
    slug: get(COL.SLUG),
    fullName: get(COL.NAME),
    jobTitle: get(COL.TITLE),
    department: get(COL.DEPT),
    phone: get(COL.PHONE),
    email: get(COL.EMAIL),
    website: get(COL.WEBSITE),
    photoUrl: get(COL.PHOTO),
    whatsapp: get(COL.WHATSAPP),
    objectId: get(COL.OBJECT_ID),
    saveLink: get(COL.SAVE_LINK),
  };
}

/** A row is blank when it has no ID, slug or name. */
function isBlankEmployee_(emp) {
  return !emp.employeeId && !emp.slug && !emp.fullName;
}

/** Writes a value to one cell by header name (row is 1-based). */
function setCell_(sheet, map, rowNumber, header, value) {
  sheet.getRange(rowNumber, map[headerKey_(header)] + 1).setValue(value);
}

/** Returns the Logs sheet, creating it with headers if needed. */
function getLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_LOGS);
  if (!sheet) sheet = ss.insertSheet(SHEET_LOGS);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Appends one line to the Logs tab. Never throws. */
function log_(action, rowNumber, employeeId, status, message) {
  try {
    getLogSheet_().appendRow([new Date(), action, rowNumber || '', employeeId || '', status,
      String(message || '').slice(0, 1000)]);
  } catch (err) {
    console.error('Could not write to Logs: ' + err);
  }
}

/* =========================================================================
 * 6. WALLET JOBS (batch runner with time limit and resume)
 * ========================================================================= */

function cursorKey_(mode) {
  return 'WALLET_CURSOR_' + mode.toUpperCase();
}

/**
 * Loops over the Employees rows for "generate" or "update". Each row is
 * written as soon as it is done, so progress survives a timeout. When the
 * time budget runs out, the next row number is saved and the user is asked
 * to run the action again.
 */
function runWalletJob_(mode) {
  const ui = SpreadsheetApp.getUi();
  const action = mode === 'generate' ? 'Generate Wallet Links' : 'Update Wallet Passes';
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) {
    ui.alert('Another Wallet job is already running. Try again in a few minutes.');
    return;
  }

  const started = Date.now();
  const props = PropertiesService.getDocumentProperties();
  const stats = { done: 0, skipped: 0, failed: 0 };
  let stoppedAt = 0;

  try {
    const cfg = getWalletConfig_();
    const { sheet, map } = getEmployeesSheet_();
    const values = sheet.getDataRange().getValues();
    const duplicates = findDuplicateSlugs_(values, map);

    if (mode === 'generate') ensureClass_(cfg);

    let startRow = Number(props.getProperty(cursorKey_(mode))) || 2;
    if (startRow < 2 || startRow > values.length) startRow = 2;

    for (let r = startRow; r <= values.length; r++) {
      if (Date.now() - started > MAX_RUNTIME_MS) {
        stoppedAt = r;
        break;
      }

      const emp = rowToEmployee_(values[r - 1], map);
      if (isBlankEmployee_(emp)) continue;

      try {
        const result = mode === 'generate'
          ? generateRow_(cfg, sheet, map, r, emp, duplicates)
          : updateRow_(cfg, sheet, map, r, emp, duplicates);
        stats[result]++;
        if (result === 'done') log_(action, r, emp.employeeId, 'OK', emp.slug);
      } catch (err) {
        stats.failed++;
        log_(action, r, emp.employeeId, 'ERROR', err.message);
      }
    }

    if (stoppedAt) {
      props.setProperty(cursorKey_(mode), String(stoppedAt));
    } else {
      props.deleteProperty(cursorKey_(mode));
    }
    SpreadsheetApp.flush();

    let msg = action + ' finished.\n\nDone: ' + stats.done + '\nSkipped: ' + stats.skipped +
      '\nFailed: ' + stats.failed;
    if (stats.failed) msg += '\n\nSee the Logs tab for details.';
    if (stoppedAt) {
      msg = action + ' stopped at row ' + stoppedAt + ' to stay within the Apps Script time limit.\n\n' +
        'Done: ' + stats.done + ', skipped: ' + stats.skipped + ', failed: ' + stats.failed +
        '\n\nRun "' + action + '" again to continue from row ' + stoppedAt + '.';
    }
    ui.alert(msg);
  } catch (err) {
    log_(action, '', '', 'ERROR', err.message);
    ui.alert(action + ' could not run.\n\n' + err.message);
  } finally {
    lock.releaseLock();
  }
}

/** Inserts the pass object for one row. Returns 'done' or 'skipped'. */
function generateRow_(cfg, sheet, map, rowNumber, emp, duplicates) {
  if (emp.objectId) return 'skipped';
  validateEmployee_(emp, duplicates);

  const objectId = cfg.issuerId + '.' + objectSuffix_(emp);
  const obj = buildGenericObject_(cfg, emp, objectId);

  let res = walletRequest_(cfg, 'post', GENERIC_OBJECT_URL, obj);
  if (res.code === 409) {
    // The object already exists (for example the ID cell was cleared).
    // Bring it up to date instead of failing.
    res = walletRequest_(cfg, 'patch', GENERIC_OBJECT_URL + '/' + encodeURIComponent(objectId), obj);
  }
  if (res.code !== 200) throw apiError_('Insert object', res);

  const saveLink = SAVE_URL_PREFIX + createSaveJwt_(cfg, objectId);
  setCell_(sheet, map, rowNumber, COL.OBJECT_ID, objectId);
  setCell_(sheet, map, rowNumber, COL.SAVE_LINK, saveLink);
  setCell_(sheet, map, rowNumber, COL.UPDATED, new Date());
  return 'done';
}

/** PATCHes the pass object for one row. Returns 'done' or 'skipped'. */
function updateRow_(cfg, sheet, map, rowNumber, emp, duplicates) {
  if (!emp.objectId) return 'skipped';
  validateEmployee_(emp, duplicates);
  if (emp.objectId.indexOf(cfg.issuerId + '.') !== 0) {
    throw new Error('Wallet Object ID does not start with this ISSUER_ID.');
  }

  const obj = buildGenericObject_(cfg, emp, emp.objectId);
  const res = walletRequest_(cfg, 'patch', GENERIC_OBJECT_URL + '/' + encodeURIComponent(emp.objectId), obj);
  if (res.code === 404) {
    throw new Error('Pass object not found. Clear the Wallet Object ID and Wallet Save Link cells, ' +
      'then run Generate Wallet Links.');
  }
  if (res.code !== 200) throw apiError_('Patch object', res);

  setCell_(sheet, map, rowNumber, COL.UPDATED, new Date());
  return 'done';
}

/** Throws if a row cannot be turned into a pass. */
function validateEmployee_(emp, duplicates) {
  if (!emp.employeeId) throw new Error('Employee ID is empty.');
  if (!emp.fullName) throw new Error('Full Name is empty.');
  const slug = parseSlug_(emp.slug);
  if (!slug || slug !== emp.slug) {
    throw new Error('Card Slug "' + emp.slug + '" is invalid. Use only a-z, 0-9 and hyphens.');
  }
  if (duplicates[slug]) throw new Error('Card Slug "' + slug + '" is used by more than one row.');
}

/** Returns { slug: true } for slugs that appear on more than one row. */
function findDuplicateSlugs_(values, map) {
  const seen = {};
  const dupes = {};
  for (let i = 1; i < values.length; i++) {
    const slug = parseSlug_(values[i][map[headerKey_(COL.SLUG)]]);
    if (!slug) continue;
    if (seen[slug]) dupes[slug] = true;
    seen[slug] = true;
  }
  return dupes;
}

/** Object ID suffix from Employee ID (allowed: A-Z a-z 0-9 . _ -). */
function objectSuffix_(emp) {
  const id = emp.employeeId.replace(/[^A-Za-z0-9._-]/g, '_');
  return 'staff_' + (id || emp.slug);
}

/* =========================================================================
 * 7. WALLET PASS CONTENT (Generic class and object)
 * ========================================================================= */

/**
 * Makes sure the company's Generic class exists. Generic classes hold very
 * little: the logo, colour, barcode and text all live on each object (see
 * README "Assumptions"). MULTIPLE_HOLDERS lets the same object be saved by
 * more than one account, so a visitor saving a staff card does not lock the
 * staff member out of their own pass.
 */
function ensureClass_(cfg) {
  const url = GENERIC_CLASS_URL + '/' + encodeURIComponent(cfg.classId);
  const res = walletRequest_(cfg, 'get', url);
  if (res.code === 200) return;
  if (res.code !== 404) throw apiError_('Get class', res);

  const insert = walletRequest_(cfg, 'post', GENERIC_CLASS_URL, {
    id: cfg.classId,
    multipleDevicesAndHoldersAllowedStatus: 'MULTIPLE_HOLDERS',
  });
  if (insert.code !== 200 && insert.code !== 409) throw apiError_('Insert class', insert);
  log_('Create class', '', '', 'OK', cfg.classId);
}

/**
 * Builds a GenericObject resource. Arrays are always sent, so PATCH replaces
 * them and removed details (for example a deleted phone number) disappear
 * from the pass.
 */
function buildGenericObject_(cfg, emp, objectId) {
  const cardUrl = buildCardUrl_(cfg.baseUrl, emp.slug);
  const phoneHref = telHref_(emp.phone);
  const email = isEmail_(emp.email) ? emp.email : '';
  const website = safeWebUrl_(emp.website);
  const photo = safeHttpsUrl_(emp.photoUrl);

  const obj = {
    id: objectId,
    classId: cfg.classId,
    state: 'ACTIVE',
    cardTitle: localized_(cfg.companyName),
    header: localized_(emp.fullName),
    hexBackgroundColor: cfg.cardColor,
    barcode: {
      type: 'QR_CODE',
      value: cardUrl,
      alternateText: emp.slug,
    },
    textModulesData: [],
    linksModuleData: { uris: [] },
    imageModulesData: [],
  };

  if (emp.jobTitle) obj.subheader = localized_(emp.jobTitle);
  if (cfg.logoUrl) obj.logo = image_(cfg.logoUrl, cfg.companyName + ' logo');
  if (photo) obj.imageModulesData.push({ id: 'photo', mainImage: image_(photo, 'Photo of ' + emp.fullName) });

  if (emp.department) obj.textModulesData.push({ id: 'department', header: 'Department', body: emp.department });
  if (phoneHref) obj.textModulesData.push({ id: 'phone', header: 'Phone', body: emp.phone });
  if (email) obj.textModulesData.push({ id: 'email', header: 'Email', body: email });

  if (phoneHref) obj.linksModuleData.uris.push({ id: 'call', uri: phoneHref, description: 'Call' });
  if (email) obj.linksModuleData.uris.push({ id: 'email', uri: 'mailto:' + email, description: 'Email' });
  const wa = whatsAppHref_(emp, cfg, false);
  if (wa) obj.linksModuleData.uris.push({ id: 'whatsapp', uri: wa, description: 'Chat on WhatsApp' });
  if (website) obj.linksModuleData.uris.push({ id: 'website', uri: website, description: 'Website' });
  obj.linksModuleData.uris.push({ id: 'card', uri: cardUrl, description: 'Digital name card' });

  return obj;
}

function localized_(value) {
  return { defaultValue: { language: 'en-US', value: String(value) } };
}

function image_(uri, description) {
  return { sourceUri: { uri: uri }, contentDescription: localized_(description) };
}

/** Card page URL for a slug: BASE_URL?card=<slug> (or &card= if BASE_URL has a query). */
function buildCardUrl_(baseUrl, slug) {
  const sep = baseUrl.indexOf('?') === -1 ? '?' : '&';
  return baseUrl + sep + 'card=' + encodeURIComponent(slug);
}

/* =========================================================================
 * 8. AUTH, JWT SIGNING AND HTTP
 * ========================================================================= */

/**
 * Signs a JWT with RS256 using the service account private key.
 * header.payload are base64url encoded without "=" padding.
 */
function signJwt_(payload, privateKey) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const encode = (obj) => base64Url_(Utilities.newBlob(JSON.stringify(obj)).getBytes());
  const input = encode(header) + '.' + encode(payload);
  const signature = Utilities.computeRsaSha256Signature(input, privateKey);
  return input + '.' + base64Url_(signature);
}

function base64Url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

/**
 * Returns an OAuth access token for the Wallet API by exchanging a signed JWT
 * at the Google token endpoint. Cached for slightly less than its lifetime.
 */
function getAccessToken_(cfg) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'wallet_token_' + Utilities.base64EncodeWebSafe(cfg.clientEmail).slice(0, 200);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt_({
    iss: cfg.clientEmail,
    scope: WALLET_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }, cfg.privateKey);

  const res = UrlFetchApp.fetch(TOKEN_URL, {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: assertion,
    },
    muteHttpExceptions: true,
  });
  const body = parseJson_(res.getContentText());
  if (res.getResponseCode() !== 200 || !body.access_token) {
    throw new Error('Could not get an access token (' + res.getResponseCode() + '): ' +
      (body.error_description || body.error || 'unknown error'));
  }

  const ttl = Math.max(60, Math.min(Number(body.expires_in || 3600) - 300, 21600));
  cache.put(cacheKey, body.access_token, ttl);
  return body.access_token;
}

/**
 * Builds the "Add to Google Wallet" JWT. The payload references only the
 * object ID: the object was already inserted through the REST API, which is
 * what lets later PATCH calls update saved passes.
 */
function createSaveJwt_(cfg, objectId) {
  return signJwt_({
    iss: cfg.clientEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    payload: { genericObjects: [{ id: objectId }] },
  }, cfg.privateKey);
}

/**
 * Calls the Wallet REST API. Retries up to 3 times on 429 and 5xx with
 * backoff. Returns { code, body }.
 */
function walletRequest_(cfg, method, url, payload) {
  const options = {
    method: method,
    headers: { Authorization: 'Bearer ' + getAccessToken_(cfg) },
    muteHttpExceptions: true,
  };
  if (payload) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }

  let res;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    if (code !== 429 && code < 500) break;
    if (attempt < 3) Utilities.sleep(1000 * Math.pow(2, attempt));
  }
  return { code: res.getResponseCode(), body: parseJson_(res.getContentText()) };
}

function apiError_(label, res) {
  const detail = (res.body && res.body.error && res.body.error.message) || 'no details';
  return new Error(label + ' failed (HTTP ' + res.code + '): ' + String(detail).slice(0, 500));
}

function parseJson_(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return {};
  }
}

/* =========================================================================
 * 9. INPUT CLEANING AND VALIDATION
 * ========================================================================= */

function clean_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

/** Returns a valid slug, or '' when the input is not allowed. */
function parseSlug_(raw) {
  const slug = clean_(raw).toLowerCase();
  return slug.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(slug) ? slug : '';
}

/** Accepts http(s) URLs. Adds https:// when no scheme is given. */
function safeWebUrl_(raw) {
  let url = clean_(raw);
  if (!url) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
  return /^https?:\/\/[^\s"'<>]+$/i.test(url) ? url : '';
}

/** Accepts only https URLs (images, logo). */
function safeHttpsUrl_(raw) {
  const url = clean_(raw);
  return /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : '';
}

/** BASE_URL: adds https:// if missing and removes a trailing slash. */
function normaliseBaseUrl_(raw) {
  return safeWebUrl_(raw).replace(/\/+$/, '');
}

/** Returns #rrggbb or ''. Accepts #rgb and #rrggbb. */
function normaliseHex_(raw) {
  const hex = clean_(raw).toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
  if (/^#[0-9a-f]{3}$/.test(hex)) return '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  return '';
}

/** Picks white text when it meets WCAG AA (4.5:1) on the colour, otherwise
 *  whichever of black or white has more contrast. */
function textColourFor_(hex) {
  const lum = (h) => {
    const c = [1, 3, 5].map((i) => {
      const v = parseInt(h.substr(i, 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const l = lum(hex);
  const contrastWhite = 1.05 / (l + 0.05);
  const contrastBlack = (l + 0.05) / 0.05;
  return contrastWhite >= 4.5 || contrastWhite >= contrastBlack ? '#ffffff' : '#111111';
}

/** tel: link from a phone number, or '' if there are too few digits. */
function telHref_(phone) {
  const p = clean_(phone);
  const digits = p.replace(/\D/g, '');
  if (digits.length < 3) return '';
  return 'tel:' + (p.charAt(0) === '+' ? '+' : '') + digits;
}

/**
 * WhatsApp click-to-chat link (https://wa.me/<number>), or '' if none.
 * The WhatsApp column may hold a number, or "same" / "yes" to reuse Phone.
 * A number without "+" is treated as local and gets DEFAULT_COUNTRY_CODE
 * (60 = Malaysia): 012-345 6789 or 12-345 6789 -> 60123456789. withMessage adds a pre-filled greeting.
 */
function whatsAppHref_(emp, cfg, withMessage) {
  const raw = whatsAppNumber_(emp);
  if (!raw) return '';
  let digits = raw.replace(/\D/g, '');
  if (raw.charAt(0) !== '+') {
    // Local number: 012-345 6789, or 12-345 6789 when Sheets dropped the 0.
    // Numbers from other countries must be typed with + and their code.
    if (digits.charAt(0) === '0') digits = cfg.countryCode + digits.slice(1);
    else if (digits.indexOf(cfg.countryCode) !== 0) digits = cfg.countryCode + digits;
  }
  if (digits.length < 8 || digits.length > 15) return '';
  let url = 'https://wa.me/' + digits;
  if (withMessage) {
    const first = clean_(emp.fullName).split(/\s+/)[0] || '';
    const msg = 'Hi ' + first + ', I got your contact from your ' + cfg.companyName + ' name card.';
    url += '?text=' + encodeURIComponent(msg);
  }
  return url;
}

/** The WhatsApp number as typed in the sheet (or Phone when set to "same"/"yes"). */
function whatsAppNumber_(emp) {
  const v = clean_(emp.whatsapp);
  if (/^(same|yes|y)$/i.test(v)) return clean_(emp.phone);
  return v;
}

function isEmail_(email) {
  return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(clean_(email));
}

function initials_(fullName) {
  const parts = clean_(fullName).split(/\s+/).filter(Boolean);
  const first = parts[0] ? parts[0].charAt(0) : '';
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return (first + last).toUpperCase();
}
