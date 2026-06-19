# Vaeroex Domain Migration Checklist

Purpose: prepare `vaeroex.com` to move from the current public website host to the Vercel-hosted Next.js Vaeroex site.

Do not point `vaeroex.com` to Vercel until the public pages, authentication, protected app routes, and rollback plan are verified.

## Pre-Migration Verification

- [ ] Verify public homepage loads at `/`.
- [ ] Verify public pricing page loads at `/pricing`.
- [ ] Verify public about page loads at `/about`.
- [ ] Verify public contact page loads at `/contact`.
- [ ] Verify public demo request page loads at `/demo`.
- [ ] Verify public Help Hub loads at `/help`.
- [ ] Verify Trust Center loads at `/trust`.
- [ ] Verify legal pages load:
  - `/terms`
  - `/privacy`
  - `/acceptable-use`
  - `/refund-policy`
  - `/ai-disclaimer`
  - `/sensitive-data-policy`
  - `/release-notes`
- [ ] Verify public navigation links work.
- [ ] Verify footer legal links work.
- [ ] Verify no customer-facing public page mentions Squarespace.

## App and Auth Verification

- [ ] Verify `/login` loads.
- [ ] Verify `/signup` loads if signup is enabled.
- [ ] Verify `/app` remains protected when logged out.
- [ ] Verify a logged-in user can access `/app`.
- [ ] Verify existing authentication callback still works.
- [ ] Verify subscription gating still works.
- [ ] Verify pricing CTA still points to the intended Vaeroex checkout destination.

## Contact and Demo Verification

- [ ] Submit a test contact request from `/contact`.
- [ ] Confirm the request appears in the existing support request/admin review flow.
- [ ] Submit a test demo request from `/demo`.
- [ ] Confirm the request appears in the existing support request/admin review flow.
- [ ] Confirm submissions do not expose admin data.
- [ ] Confirm sensitive data warnings are visible.

## Vercel Domain Setup

- [ ] Open the Vaeroex Vercel project.
- [ ] Add `vaeroex.com` to Vercel Domains.
- [ ] Add `www.vaeroex.com` if the www hostname should also resolve to Vercel.
- [ ] Review the DNS records Vercel provides.
- [ ] Update DNS records at the domain provider.
- [ ] Wait for Vercel SSL certificate provisioning.
- [ ] Confirm Vercel shows the domain as valid.

## Post-DNS Verification

- [ ] Test `https://vaeroex.com` in a normal browser session.
- [ ] Test `https://vaeroex.com` in an incognito/private browser session.
- [ ] Test `https://www.vaeroex.com` if configured.
- [ ] Test `/pricing`, `/about`, `/contact`, `/demo`, `/help`, `/trust`, and all legal pages.
- [ ] Test `/login`.
- [ ] Test `/signup` if signup is enabled.
- [ ] Test `/app` while logged out.
- [ ] Test `/app` while logged in.
- [ ] Test auth redirects and callback URLs.
- [ ] Test contact and demo submissions again after DNS migration.
- [ ] Test redirects from any known old public URLs.

## Rollback Plan

- [ ] Keep the current public website host available until Vercel production is verified.
- [ ] Keep the previous DNS records documented before changing them.
- [ ] If critical public pages, login, signup, checkout, or `/app` fail, restore prior DNS records.
- [ ] After rollback, wait for DNS propagation and retest public pages and login.

## Final Launch Notes

- [ ] Do not claim SOC 2, HIPAA compliance, guaranteed security, guaranteed Vaeroex accuracy, or guaranteed business results unless those claims are formally supported.
- [ ] Keep customer-facing billing language Vaeroex-owned: Vaeroex checkout, Vaeroex Direct Website, official Vaeroex sales channels, and Vaeroex subscription.
- [ ] Keep internal provider details in internal documentation only.
