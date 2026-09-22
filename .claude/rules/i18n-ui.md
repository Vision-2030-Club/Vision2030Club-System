---
paths:
  - "messages/**"
  - "src/**/*.tsx"
---

# Text, languages and UI

- Every user-facing string goes through `next-intl`: add the key to BOTH
  `messages/en.json` and `messages/ar.json` in the same commit. A key
  missing from one catalog crashes that language at runtime. Never
  hard-code a sentence in a component.
- Arabic is the primary language and the site is RTL there. Use logical
  CSS (`ms-`, `me-`, `start`, `end`) rather than `ml-`/`mr-`/`left`/`right`.
  Wrap numbers, phone numbers, IDs and URLs in `ltr-nums` or `dir="ltr"`.
- Use the shared primitives in `src/components/ui.tsx` (`Card`, `Button`,
  `Input`, `Label`, `Alert`, `Badge`, `PageHeader`) and colour tokens
  (`bg-surface`, `text-ink`, `border-line`, `bg-brand-600`). Never hard-code
  a hex colour or `bg-white` in a component; the interviews theme repaints
  the tokens and a raw colour breaks it.
- Server actions return `ActionResult` and refusals come back with a
  `hint` that maps to `errors.<hint>` in the catalogs. Add the translation
  when you add a hint.
- Layouts must work at phone width. Check the Arabic view as well as the
  English one on the Vercel preview before asking for review.
