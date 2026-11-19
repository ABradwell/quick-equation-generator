# Agent rules

## GitHub account

This repo belongs to the `ABradwell` GitHub account. All commits, pushes, and PR operations must be made as `ABradwell`.

The machine is usually signed in to a different account by default. Before any commit, push, or `gh` call that writes to GitHub:

1. Check the active account: `gh auth status`
2. If `ABradwell` is not active, record the current account and switch: `gh auth switch --user ABradwell`
3. Commit, push, and open or merge the PR.
4. Switch back to the account that was active before: `gh auth switch --user <previous-account>`

Always switch back, even if a step fails.

Commit author email must match the `ABradwell` account, not a work address. If `git config user.email` in this repo returns a work address, pass the correct one for the commit (for example `git -c user.email=<ABradwell email> commit ...`), using the email from earlier `ABradwell` commits in `git log`.

## Workflow

- All changes land through a pull request. Never push directly to `main`.
- Create a branch, push it, and open a PR with `gh pr create`.
- Agents have permission to merge their own PRs once CI passes.
