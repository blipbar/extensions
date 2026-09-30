# Blipbar extensions

The directory Blipbar's **Browse…** shows (Settings › Blips). Each extension here has one
small entry pointing at a release of its own repo, pinned by the file's SHA-256. A person
reads the source of every version before it's listed, and Blipbar checks the file it
downloads is that exact one before installing it.

## Add yours

1. Put the extension's source in a public GitHub repo. New to it? The prompts at
   [blipbar.app/docs](https://blipbar.app/docs/) get an AI to build one with you.
2. In its folder, run `npx blipkit pack`. It makes `<name>-<version>.blipbar`.
3. Make a GitHub release of that version (tag it `v1.2.0`, say) and attach the file.
4. Get the file's hash: `shasum -a 256 <name>-<version>.blipbar`.
5. Open a pull request here that adds `extensions/<your id>.json`:

   ```json
   {
     "id": "dev.yourname.weather",
     "repo": "yourname/blipbar-weather",
     "version": "1.2.0",
     "file": "https://github.com/yourname/blipbar-weather/releases/download/v1.2.0/weather-1.2.0.blipbar",
     "sha256": "…"
   }
   ```

A check runs on the pull request: it downloads the file and checks its hash, then writes a
summary of what the extension can reach, run and sign in to, with a link to its source at
that version. Once it's merged, it shows in Browse… within minutes.

## Updates

Change the same entry's `version`, `file` and `sha256` in a new pull request. Every version
is reviewed, and the check links to what changed since the last one. An extension stays with
its repo: an update from a different one is refused.

## What's checked

- The id is reverse-DNS (`dev.yourname.weather`), the file is named for it, and
  `dev.blipbar.` ids are Blipbar's own.
- The manifest's id and version match the entry, and its `author` says who made it. Only the
  blipbar organization publishes as "Blipbar".
- The file comes from the repo's own release, is under 20 MB, and holds plain files only.

Then a reviewer reads the source, looking for:

- whether it does what its description says, and reaches only what it needs
- code hidden or minified beyond what the build does
- tracking of any kind
- keys kept anywhere but a `password` preference

## Questions

Ask in the [Discord](https://discord.gg/FYHPMd66AG).
