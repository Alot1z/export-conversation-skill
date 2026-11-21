# Changelog

All notable changes to the export-conversation skill will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2026-11-21

### Added
- Secret redaction gate (`scripts/redact.mjs`) with check and write modes
- Render manifest, HTML review gallery, diagram lint and layout warnings
- Export validator for structure, coverage, secrets and render evidence
- Incremental marker-based merge that preserves manual blocks
- Multi-root installer with `--check` drift detection
- Local image copying with alt-text filling (`scripts/assets.mjs`)
- Release consistency checks and CI matrix

### Changed
- Skill workflow now runs redact, render, validate and merge as Steps 4a-4d
- Renderer supports `--offline`, `--mmdc`, `--timeout`, `--jobs`, `--strict-layout`, `--strict-lint` and `--max-diagrams`

## [2.1.0] - 2026-11-21

### Added
- Step 4b: every Mermaid block must be rendered and inspected, not just counted
- `skills/export/scripts/render-mermaid.mjs` renderer/validator (SVG + PNG, size table, non-zero exit on failure)
- `--out` and `--no-png` options

### Changed
- Renderer builds one quoted shell command instead of passing an argument array with `shell: true`
- Default input is the newest `conversation-export-*.md`; no project-specific path
- Puppeteer config always enables `--no-sandbox`, with a local browser when available

### Fixed
- Paths containing spaces no longer break rendering
- `DEP0190` warning from `shell: true` with an args array

## [2.0.0] - 2026-04-08

### Added
- ✨ Comprehensive Mermaid diagram support with 7 diagram types
- 📊 Visual Overview section in exports
- 🎨 Architecture diagrams (`graph TD/LR`)
- 🔄 Sequence diagrams (`sequenceDiagram`)
- 📈 Flowcharts (`flowchart`)
- 🏗️ Class diagrams (`classDiagram`)
- 🔀 State diagrams (`stateDiagram-v2`)
- 🌿 Git graphs (`gitGraph`)
- 🗄️ ER diagrams (`erDiagram`)
- 📋 Diagram quality standards and guidelines
- 🎯 Smart diagram inclusion based on conversation content
- 📝 Enhanced conversation review checklist

### Changed
- 📖 Updated export format to include Visual Overview section
- 🎨 Improved export template structure
- 📊 Enhanced confirmation message to include diagram count

### Documentation
- 📚 Added detailed diagram type selection guide
- 📖 Documented when to create/skip diagrams
- ✍️ Added diagram quality standards
- 📝 Expanded examples with architecture session

## [1.0.0] - 2026-04-08

### Added
- 🎉 Initial release of export-conversation skill
- 📝 Basic conversation export functionality
- 📊 Session statistics tracking
- 📁 File change logging with action types
- 🕐 Automatic timestamp generation for filenames
- 🎯 Custom filename and path support
- 🔒 Sensitive data sanitization (API keys, passwords)
- 📋 Conversation summary generation
- 🔧 Tool usage tracking (Bash, Read, Write, Edit, etc.)
- 📖 Comprehensive documentation in SKILL.md
- ✅ Edge case handling (empty conversations, failed tools)
- 🎨 Well-formatted markdown output
- 📈 Chronological message ordering
- 💬 User and assistant message capture
- 🗂️ Support for directory paths in output

### Documentation
- 📚 Created initial SKILL.md with complete instructions
- 📖 Added usage examples and guidelines
- 📝 Documented five-step execution process
- ✍️ Included export format template

---

## Version History Summary

- **v2.0.0** - Added comprehensive diagram support with Mermaid
- **v1.0.0** - Initial release with core export functionality

## Future Roadmap

### Under Consideration
- 📑 Table of contents generation for long exports
- 🎨 Customizable export templates
- 🔍 Filtering options (by tool type, message type)
- 📤 Additional export formats (PDF, HTML)
- 📊 Enhanced statistics dashboard
- 🔄 Incremental exports (append to existing file)
- 🏷️ Tagging and categorization
- 🔍 Full-text search in exports
- 📎 Attachment support for images/files
- 🌐 Export to common documentation platforms

### Community Requests
- Open an [issue](https://github.com/Alot1z/export-conversation-skill/issues) to suggest features!

---

**Note:** This skill follows semantic versioning. Breaking changes will increment the major version.
