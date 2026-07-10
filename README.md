# Ortus Club · HubSpot Sync (Chrome Extension)

Lookup or push the LinkedIn profile you're viewing into Ortus Club's HubSpot.

## How it works

1. Open a LinkedIn profile (regular `linkedin.com/in/<slug>` or Sales Navigator).
2. Click the extension's toolbar icon.
3. The popup scrapes name, company, job title, and the numeric LinkedIn member ID, then searches HubSpot for `<memberId>@linkedinmembership.id`.
4. If absent → **Push to HubSpot**. If present → **Update / Skip**.

## Install (developer mode)

1. `chrome://extensions` → enable **Developer mode** (top right).
2. Click **Load unpacked** → select this folder.
3. Pin the extension to the toolbar.

## Ship a new build

```bash
sh pack.sh
# For the signed managed build:
sh pack-crx.sh
```

The extension contains no HubSpot private-app token. Signed builds must use the
existing `ortus-ext-signing-key.pem`, which is ignored by Git and must remain private.

## Token rotation

To rotate:

1. In HubSpot, rotate the Private App token. Confirm scopes: `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.schemas.contacts.read`.
2. Run `sh proxy/set-hubspot-token.sh` and enter the token at Wrangler's prompt.
3. Test the Settings connection checks. No extension rebuild is required for token rotation.

## Manual smoke test

After installing:

- [ ] **Settings tab** shows ✓ for "API token valid" and "Custom property `linkedin_membership_id`".
- [ ] On a non-LinkedIn tab, popup says *"Open a LinkedIn profile to begin."*
- [ ] On a regular `linkedin.com/in/<slug>` profile that is **not** in HubSpot, popup shows the dossier and a **Push to HubSpot** CTA.
- [ ] Click *Push to HubSpot* → popup transitions to *Pushed ✓* with a *View in HubSpot* link. Clicking the link opens the contact, with `firstname`, `lastname`, `company`, `jobtitle`, `email`, and `linkedin_membership_id` set.
- [ ] Reopen the popup on the same profile → it shows *Already in HubSpot* with **Update** and **Skip**.
- [ ] Click *Update* → *Updated ✓*. The contact in HubSpot reflects the latest scraped values.
- [ ] If the contact has a real primary email, click *Update* → the synthetic LinkedIn membership email is added as an additional email and the primary remains unchanged. Repeating Update does not duplicate it.
- [ ] Add a note from the Manage section → it appears on the contact timeline without opening the HubSpot record.
- [ ] Repeat on a Sales Navigator profile (`linkedin.com/sales/lead/...`) — same outcomes.
- [ ] On a profile where job title is unparseable, popup shows the *Pushing without job title* warning chip and the push still succeeds.

### Test the note and email-repair changes

The updated proxy must be deployed before these two operations can reach HubSpot:

```bash
cd proxy
npm ci
npm run deploy
```

Then open `chrome://extensions`, enable Developer mode, load this folder unpacked
(or click Reload on the existing unpacked install), and test against a disposable
HubSpot contact:

- Add a note in the Manage section and confirm it appears on the contact timeline.
- Give the contact a real primary email but no LinkedIn membership email, then click Update.
- Confirm `<memberId>@linkedinmembership.id` was added as an additional email and the real primary stayed unchanged.
- Click Update again and confirm no duplicate email appears.

### Test packaged updates

Unpacked extensions do not use the hosted CRX update channel. To test the Settings
button end to end, install the signed/managed build, publish a higher signed version
to the `ortusclub/ortus-hs-ext` GitHub Pages repository, then click **Check for
updates**. Chrome downloads the update and the extension reloads once it is ready.

The signed update must use the same private key as the installed extension. Never
commit `ortus-ext-signing-key.pem`.

## Tests

Unit tests cover the scraper (against fixture HTML) and the HubSpot client (with mocked `fetch`). They do not hit real HubSpot.

```bash
npm install
npm test
npm run check:secrets
```

## Public source and secrets

The source repository is `ortusclub/ortus-hubspot-sync-extension`. HubSpot's
private-app token is stored only as the Cloudflare Worker secret `HUBSPOT_TOKEN`.
The repository ignores private keys, `.dev.vars`, `.env` files, Wrangler state,
and packaged ZIP/CRX builds. GitHub Actions runs the secret scan before tests.

## Architecture

See `docs/superpowers/specs/2026-04-30-hubspot-linkedin-sync-design.md`.
