import { describe, it, expect } from 'vitest'
import { PatternExtractor } from '../src/extractor.js'
import type { ExtractionResult } from '../src/types.js'

describe('PatternExtractor', () => {
  const extractor = new PatternExtractor()

  it('should extract key-value facts from structured text', () => {
    const text = `
Client: John Smith
Phone: (555) 123-4567
Email: john@example.com
    `
    const result = extractor.extract(text)

    expect(result.facts).toHaveLength(3)
    expect(result.facts[0]).toEqual({ label: 'Client', value: 'John Smith' })
  })

  it('should classify entities by type', () => {
    const text = `
Client: Jane Doe
Company: Acme Insurance
Address: 123 Main St, Suite 100
Phone: 555-987-6543
Email: jane@acme.com
Premium: $1,250.00
    `
    const result = extractor.extract(text)

    const types = result.entities.map(e => e.type)
    expect(types).toContain('person')
    expect(types).toContain('organization')
    expect(types).toContain('address')
    expect(types).toContain('phone')
    expect(types).toContain('email')
    expect(types).toContain('money')
  })

  it('should extract standalone email patterns', () => {
    const text = 'Please contact support@company.com for help'
    const result = extractor.extract(text)

    const emails = result.entities.filter(e => e.type === 'email')
    expect(emails.length).toBeGreaterThanOrEqual(1)
    expect(emails[0].value).toBe('support@company.com')
  })

  it('should extract standalone phone patterns', () => {
    const text = 'Call us at (800) 555-1234 today'
    const result = extractor.extract(text)

    const phones = result.entities.filter(e => e.type === 'phone')
    expect(phones.length).toBeGreaterThanOrEqual(1)
  })

  it('should extract dollar amounts', () => {
    const text = 'The total premium is $2,500.00 annually'
    const result = extractor.extract(text)

    const money = result.entities.filter(e => e.type === 'money')
    expect(money.length).toBeGreaterThanOrEqual(1)
    expect(money[0].value).toBe('$2,500.00')
  })

  it('should derive relations between entities', () => {
    const text = `
Client: Alice Johnson
Address: 456 Oak Ave, Portland OR 97201
Carrier: State Farm
Policy: HO-123456
    `
    const result = extractor.extract(text)

    expect(result.relations.length).toBeGreaterThanOrEqual(1)

    const livesAt = result.relations.find(r => r.type === 'lives_at')
    expect(livesAt).toBeDefined()
    expect(livesAt!.sourceLabel).toBe('Alice Johnson')

    const insuredBy = result.relations.find(r => r.type === 'insured_by')
    expect(insuredBy).toBeDefined()
  })

  it('should deduplicate entities by type:value', () => {
    const text = `
Client: Bob Smith
Name: Bob Smith
Contact: Bob Smith
    `
    const result = extractor.extract(text)

    // Bob Smith should appear only once as a person
    const people = result.entities.filter(e => e.type === 'person' && e.value === 'Bob Smith')
    expect(people).toHaveLength(1)
  })

  it('should extract document sections from markdown headings', () => {
    const text = `# Personal Info
Name: Test User

# Coverage Details
Policy: HO-999
Premium: $500`

    const result = extractor.extract(text)

    expect(result.sections.length).toBeGreaterThanOrEqual(2)
    expect(result.sections[0].heading).toBe('Personal Info')
    expect(result.sections[1].heading).toBe('Coverage Details')
  })

  it('should extract sections from ALL CAPS headings', () => {
    const text = `PERSONAL INFORMATION
Name: Test User
Phone: 555-111-2222

COVERAGE DETAILS
Policy: HO-888`

    const result = extractor.extract(text)

    expect(result.sections.length).toBeGreaterThanOrEqual(2)
  })

  it('should return empty results for empty text', () => {
    const result = extractor.extract('')

    expect(result.entities).toHaveLength(0)
    expect(result.relations).toHaveLength(0)
    expect(result.facts).toHaveLength(0)
  })

  it('should handle date entities', () => {
    const text = `
Effective Date: 01/15/2025
Expiration: 01/15/2026
    `
    const result = extractor.extract(text)

    const dates = result.entities.filter(e => e.type === 'date')
    expect(dates.length).toBeGreaterThanOrEqual(1)
  })

  it('should handle property details', () => {
    const text = `
Year Built: 1995
Square Footage: 2,400
Roof Type: Shingle
Construction: Frame
    `
    const result = extractor.extract(text)

    const props = result.entities.filter(e => e.type === 'property')
    expect(props.length).toBeGreaterThanOrEqual(2)
  })
})
