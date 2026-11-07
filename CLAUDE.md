## Questioning

Whenever you are not sure about anything, just interview the user. Do not guess or assume things on your own for things you aren't sure about.

## Coding

### Coding style

On your first session in a project, check the project conventions. They should be in the CLAUDE.local.md file, within a Project Conventions section. If there are none, read through the project structure to find out the overall structure pattern, alongside with coding styles and write them to the Project Conventions section (create the file if needed).

Prioritize DDD style code for business logic with real domain rules.

### Comments

You should only write doc-style comments when writing a library or shared utils/helper codes. Do not write comments frequently, only comment when the code itself cannot explain why it was done this way. When a comment is needed, prioritize using comment tags like HACK, FIXME, BUG, NOTE, TODO, etc...

### Testing

You should always write and run (regression) unit tests for new implementations

### Formatting

You should always format a file after having done with it to make sure a user edit never cause a whole file to shift

## Git

### Branching

When you start to work on something, you should check out to another branch

### Commit style

Commit should be scoped, small but still meaningful, it makes the code changes way easier to track

Before your first commit in a session, decide which style applies:

- **Mature project** (git history shows a recognizable convention): read recent `git log` and follow the project's convention for subject format, scopes, casing, body and footers. It overrides the default style below. Do not ask the user.
- **New project** (no commits, or too few to show a convention): if no line starting with `Commit style:` appears in your loaded instructions, ask the user once with `AskUserQuestion` whether to use the default style below or another one, then append `Commit style: default` or `Commit style: <their description>` to `./CLAUDE.local.md` (create the file if missing). Never ask again once the line exists.

### Default style

**IMPORTANT:** Commit messages follow conventional commit format: `type(scope): subject`.
**IMPORTANT:** Before writing a commit body, consider carefully whether the commit needs one:
- Simple or self-explanatory changes: subject line only, no body.
- Bigger changes: add a body only if it tells the reader something the subject and the diff do not, and decide what is worth noting so it stays concise.

When a body is needed:
- Focus on the "why", not the "how": the motivation for the change (broken code, new feature, etc.) and the contrast with previous behavior. Do not restate the diff.
- Write in present tense, imperative mood.
- Keep lines under 80 characters.

Add footers only when they carry real information (e.g. `BREAKING CHANGE:`, issue references).

### Co-Authored-By trailer

Each user chooses once per project whether commits carry a `Co-Authored-By` trailer for Claude. The choice is recorded in `./CLAUDE.local.md` as a line starting with `Co-Authored-By trailer:`.

- If no such line appears in your loaded instructions, this is the user's first session in the project: before doing anything else, ask them with `AskUserQuestion` whether they want the trailer, then append `Co-Authored-By trailer: add` or `Co-Authored-By trailer: do not add` to `./CLAUDE.local.md` (create the file if missing). Never ask again once the line exists.
- `add`: end every commit message with `Co-Authored-By: <your model name> <noreply@anthropic.com>`.
- `do not add`: never add the trailer.
