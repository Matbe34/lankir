# Contributing

Thank you for your interest in contributing to PDF App!

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/pdf_app.git
   cd pdf_app
   ```
3. **Set up development environment**: See [Development Setup](setup.md)
4. **Create a branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Workflow

### 1. Make Changes

- Write code following the project style
- Add tests for new functionality
- Update documentation if needed

### 2. Test Your Changes

```bash
# Run all tests
task test

# Run with coverage
task test-coverage

# Run frontend tests
cd frontend && npm test
```

### 3. Build and Verify

```bash
# Ensure it builds
task build

# Test the built application
./build/bin/pdf_app --help
```

### 4. Commit Changes

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```bash
# Feature
git commit -m "feat: add certificate expiry warning"

# Bug fix
git commit -m "fix: resolve memory leak in page cache"

# Documentation
git commit -m "docs: update CLI reference"

# Refactor
git commit -m "refactor: extract common validation logic"
```

### 5. Push and Create PR

```bash
git push origin feature/your-feature-name
```

Then open a Pull Request on GitHub.

## Code Style

### Go

- Follow standard Go formatting (`gofmt`)
- Use meaningful variable names
- Add comments for exported functions
- Handle errors explicitly

```go
// Good
func (s *Service) LoadCertificates() ([]Certificate, error) {
    certs, err := s.loadFromStore()
    if err != nil {
        return nil, fmt.Errorf("failed to load from store: %w", err)
    }
    return certs, nil
}

// Avoid
func (s *Service) LoadCertificates() ([]Certificate, error) {
    c, _ := s.loadFromStore() // Don't ignore errors
    return c, nil
}
```

### JavaScript

- Use ES6+ features
- Prefer `const` over `let`
- Use meaningful function names
- Add JSDoc comments for public functions

```javascript
// Good
/** Renders the specified page to the canvas. */
export function renderPage(pageNumber, canvas) {
    const ctx = canvas.getContext('2d');
    // ...
}

// Avoid
function render(p, c) {
    var ctx = c.getContext('2d');
    // ...
}
```

### CSS

- Use Tailwind utility classes
- Custom CSS only when necessary
- Follow existing naming conventions

## Pull Request Guidelines

### Before Submitting

- [ ] Tests pass (`task test`)
- [ ] Code follows project style
- [ ] Documentation updated if needed
- [ ] Commit messages follow convention
- [ ] Branch is up to date with main

### PR Description

Include:
- **What**: Brief description of changes
- **Why**: Motivation for the change
- **How**: Implementation approach (if complex)
- **Testing**: How you tested the changes

Example:
```markdown
## What
Add certificate expiry warning in the certificate list

## Why
Users should be alerted before certificates expire to avoid signing failures

## How
- Added `expiresWithin` method to Certificate type
- Updated certificate list UI to show warning icon
- Added yellow badge for certificates expiring within 30 days

## Testing
- Added unit tests for `expiresWithin`
- Manually tested with expiring and valid certificates
```

## Areas for Contribution

### Good First Issues

Look for issues labeled `good first issue`:
- Documentation improvements
- Bug fixes with clear reproduction steps
- Small feature enhancements

### Feature Development

For larger features:
1. Open an issue first to discuss
2. Get feedback on approach
3. Implement in stages if complex

### Documentation

- Fix typos and unclear wording
- Add examples to CLI reference
- Improve architecture docs
- Translate to other languages

### Testing

- Increase test coverage
- Add integration tests
- Improve test documentation

## Code of Conduct

- Be respectful and constructive
- Welcome newcomers
- Focus on the code, not the person
- Assume good intentions

## Getting Help

- **Questions**: Open a GitHub Discussion
- **Bugs**: Open a GitHub Issue
- **Security**: Email maintainers directly

## License

By contributing, you agree that your contributions will be licensed under the project's license.

## Recognition

Contributors are recognized in:
- GitHub contributors list
- Release notes for significant contributions
- README acknowledgments

Thank you for contributing to PDF App! 🎉
