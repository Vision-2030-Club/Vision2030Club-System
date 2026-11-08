# Keys and personal data

- Never read, print, echo, or paste the contents of `.env.local`, any file
  matching `.env*`, or any key, token, password or PIN, including into a
  commit, a pull request, an issue, a chat reply, or a log line. Variable
  NAMES are fine; values are not.
- Never commit a file that holds a key. `.env.example` lists the variable
  names with empty values and is the only env file that belongs in git.
- Environment values live in Vercel, and only the project lead holds them.
  Teammates have no keys and no Vercel access: they check their work on the
  pull request's preview link, not on a local copy with data. Do not ask
  for keys in chat, and do not suggest a workaround that hands one out.
- Real people's data (members, applicants, phone numbers, CVs, emails)
  stays in the databases and the private storage buckets. Never copy it
  into the repository, a public Google Sheet, a test fixture, a screenshot,
  or a pull request. Use invented names and `05xxxxxxxx` in examples.
- Anything that is shared "anyone with the link" or made public counts as
  publishing. Ask a person first.
