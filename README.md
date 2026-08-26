# DeepSeek Harness

English | [中文](README.zh.md)

## About this fork

This is a personal fork of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness). Upstream is the source of truth for the project; this repository is not affiliated with DeepSeek AI and carries no support commitment.

**Why it exists.** The Web client shows a session's file work only where it happened — one diff card per `edit`/`write` tool row, plus the closing turn's produced-file chips. Reviewing what a session did to the workspace therefore means scrolling the whole transcript and rebuilding the per-file story by hand, and a long session buries the answer under hundreds of steps. Nothing showed which files the agent was touching right now, and nothing collected one file's repeated edits into one place.

**What it adds.** A session file rail beside the transcript listing what the session read and changed, plus an inline side-by-side diff — before on the left, after on the right, paired line by line — that opens by default and is governed by a General setting. Descendant subagent sessions are read through the durable child catalog and merged in, one row per file with each segment labelled by the agent, turn, and tool that made it. The design, its rejected alternatives, and its known limits are recorded in [the file panel Agent Note](.agents/notes/proposed/feature/2026-08-26-web-session-file-panel.md).

A `Files` control opens the rail at the head of the view tabs; a mutation row arrives with its change already open:

![The session file rail beside the transcript, with a write row expanded on arrival](docs/user/guide/session-file-rail.png)

Expanding a produced file compares its content before and after — one segment per recorded change, labelled with the turn and tool that made it, so a file written once and edited twice reads as the three steps it was:

![The inline side-by-side diff, removed lines left and added lines right, aligned row by row](docs/user/guide/session-file-diff.png)

**Status.** A work in progress that tracks upstream. Branches here may contain unfinished work from several parallel efforts; nothing is promised stable, and changes are not upstreamed automatically. The MIT license and every upstream notice are inherited unchanged — see [LICENSE](LICENSE).

---

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
