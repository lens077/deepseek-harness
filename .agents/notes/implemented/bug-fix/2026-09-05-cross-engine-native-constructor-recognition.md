# Agent Note: Cross-engine native constructor recognition

Status: implemented

English | [中文](2026-09-05-cross-engine-native-constructor-recognition.zh.md)

## Problem

`snapshotJsonValue()` accepts intrinsic Object and Array containers from any JavaScript realm while rejecting class instances and forged prototypes. The intrinsic check identifies the constructor with its name, prototype identity, and native function source.

JavaScript engines format native function source differently. Chromium renders `function Object() { [native code] }`, while Firefox inserts line breaks and indentation around `[native code]`. Requiring the Chromium string rejects every ordinary Firefox object as non-JSON.

Session v2 Assistant settlements embed raw stream chunks as JSON objects. In Firefox, opening or paging a Session containing those records throws during Conversation assembly after `session/page` succeeds. Subscriber isolation contains the exception, but no Chat rows reach the UI, so **Load earlier** appears to do nothing.

## Decision

`hasIntrinsicConstructor()` retains the constructor-name and prototype-identity checks. It requires the exact `function Object() {` or `function Array() {` prefix, the closing brace, and a body containing only optional whitespace around `[native code]`.

The check accepts engine-owned whitespace without accepting user-authored constructors, subclasses, custom prototypes, or forged constructor names. `snapshotJsonValue()` keeps its existing lossless JSON rules, single-read property traversal, detached output, and cross-realm support.

## Alternatives considered

**Require one native function string.** Rejected because ECMAScript does not require engines to use Chromium's whitespace inside a native function body, and Firefox uses a different valid rendering.

**Round-trip through `JSON.stringify()` and `JSON.parse()`.** Rejected because that path invokes serialization hooks, drops unsupported members, cannot preserve the validator's one-read guarantee, and does not distinguish every rejected container.

**Accept any prototype whose constructor is named Object or Array.** Rejected because a user function can forge its name and prototype link; the native-source check is what keeps custom containers outside the accepted JSON set.

## Consequences

Firefox accepts the same plain and cross-realm JSON containers as Chromium, so embedded Assistant streams assemble and paged history reaches Chat. Exotic containers and lossy values remain rejected.

The focused regression replaces only native-function whitespace inside a `try/finally` and restores the process-global method immediately. The Assistant stream suite continues to reject malformed raw chunks. A real Firefox run against the Web profile opens a 79-step Session, grows the rendered history from 98 to 156 rows after **Load earlier**, receives HTTP 200 from `session/page`, and reports no console errors.
