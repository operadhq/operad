# Publishing Operad Packages to npm

## Prerequisites

1. **npm account** with access to the `@operad` org:
   ```bash
   npm login
   npm whoami  # verify you're logged in
   ```

2. **pnpm** installed (the workspace package manager):
   ```bash
   corepack enable
   ```

3. **All packages build cleanly**:
   ```bash
   pnpm build
   pnpm test
   ```

## Package Order

Packages must be published in dependency order:

1. `@operad/core` (no internal deps)
2. `@operad/adapter-memory` (depends on core)
3. `@operad/adapter-sqlite` (depends on core)
4. `@operad/session` (depends on core, adapter-memory, adapter-sqlite)

The `pnpm -r publish` command handles this automatically via topological sorting.

## Version Bumping

Bump versions before publishing. Use one of:

```bash
# Bump a single package
cd packages/core
pnpm version patch   # 0.1.0 -> 0.1.1
pnpm version minor   # 0.1.0 -> 0.2.0
pnpm version major   # 0.1.0 -> 1.0.0

# Or bump all packages together
pnpm -r exec pnpm version patch
```

For coordinated releases, consider using `@changesets/cli` (already in devDependencies):

```bash
pnpm changeset        # create a changeset describing the change
pnpm changeset version # apply version bumps and update changelogs
```

## Build, Test, Publish

```bash
# 1. Clean previous builds
pnpm clean

# 2. Build all packages
pnpm build

# 3. Run tests
pnpm test

# 4. Publish all packages
pnpm publish:all
```

Or publish a single package:

```bash
cd packages/core
pnpm publish --no-git-checks
```

## workspace:* Protocol

pnpm uses `workspace:*` for internal dependencies during development. When you run `pnpm publish`, pnpm automatically replaces these with the actual version numbers from each package's `package.json`. For example:

```json
// In source (package.json):
"dependencies": {
  "@operad/core": "workspace:*"
}

// Published to npm as:
"dependencies": {
  "@operad/core": "^0.1.0"
}
```

No manual intervention is needed -- this is handled by pnpm at publish time.

## Dry Run

To verify what will be published without actually pushing to npm:

```bash
pnpm -r publish --no-git-checks --dry-run
```

## Troubleshooting

- **403 Forbidden**: You don't have publish access to the `@operad` org. Ask an admin to add you.
- **Build failures**: Run `pnpm clean && pnpm build` to start fresh.
- **Version conflict**: The version already exists on npm. Bump the version and try again.
- **Missing dist/**: The `prepublishOnly` script runs `pnpm run build` automatically, but if it fails, build manually first.
