# Palette's Journal - slack-archive

## 2026-11-01 - Avatars next to sender names are decorative
**Learning:** In message layouts the sender's name renders immediately beside the avatar, so the correct a11y treatment is `alt=""` - a name alt would read every name twice. File attachments are the opposite: the filename is the only text a screen reader gets, so it belongs in the alt.
**Action:** Check what text is adjacent before choosing between empty alt and descriptive alt; this repo's source-assertion tests (src/create-html-a11y.test.ts) lock the choice in.
