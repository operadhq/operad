import type { Extractor, ExtractionResult, ExtractedEntity, ExtractedRelation } from './types.js'

/**
 * PatternExtractor: regex-based entity and relation extraction.
 *
 * Zero dependencies. Runs locally. Never uploads.
 * Extracts: people, orgs, addresses, phones, emails, money, dates,
 * policies, key-value facts, and section structure.
 */
export class PatternExtractor implements Extractor {
  extract(text: string): ExtractionResult {
    const entities: ExtractedEntity[] = []
    const relations: ExtractedRelation[] = []
    const facts: Array<{ label: string; value: string }> = []
    const sections = this.extractSections(text)

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

    for (const line of lines) {
      // ─── Key: Value pairs (highest confidence — explicit structure)
      const kvMatch = line.match(/^([A-Za-z][A-Za-z\s/&.]{1,35})\s*[:–—-]\s*(.+)$/)
      if (kvMatch) {
        const label = kvMatch[1].trim()
        const value = kvMatch[2].trim()
        facts.push({ label, value })

        // Classify the fact into an entity type
        const entity = this.classifyFact(label, value, line)
        if (entity) entities.push(entity)
        continue
      }

      // ─── Standalone pattern matches
      this.extractPatterns(line, entities)
    }

    // ─── Derive relations from facts
    this.deriveRelations(facts, entities, relations)

    // Deduplicate entities by value
    const seen = new Set<string>()
    const deduped = entities.filter(e => {
      const key = `${e.type}:${e.value}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    return { entities: deduped, relations, facts, sections }
  }

  private classifyFact(label: string, value: string, source: string): ExtractedEntity | null {
    const l = label.toLowerCase()

    // Person names
    if (/^(client|customer|name|agent|referr|contact|insured|owner)/.test(l)) {
      return { type: 'person', label, value, confidence: 0.9, source }
    }

    // Organization
    if (/^(company|carrier|insurer|agency|employer|business|org)/.test(l)) {
      return { type: 'organization', label, value, confidence: 0.9, source }
    }

    // Address
    if (/^(address|location|property|home)/.test(l) && /\d/.test(value)) {
      return { type: 'address', label, value, confidence: 0.9, source }
    }

    // Phone
    if (/^(phone|cell|mobile|fax|tel)/.test(l) || /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(value)) {
      return { type: 'phone', label, value, confidence: 0.95, source }
    }

    // Email
    if (/^(email|e-mail)/.test(l) || /[\w.-]+@[\w.-]+\.\w+/.test(value)) {
      return { type: 'email', label, value, confidence: 0.95, source }
    }

    // Money
    if (/^(premium|price|cost|amount|value|coverage|deductible|limit)/.test(l) || /\$[\d,]+/.test(value)) {
      return { type: 'money', label, value, confidence: 0.9, source }
    }

    // Date
    if (/^(date|effective|expir|renew|dob|birth)/.test(l)) {
      return { type: 'date', label, value, confidence: 0.85, source }
    }

    // Policy
    if (/^(policy|quote|claim|coverage type)/.test(l)) {
      return { type: 'policy', label, value, confidence: 0.9, source }
    }

    // Property details
    if (/^(sqft|square|roof|year built|construction|flood|wind|pool|stories)/.test(l)) {
      return { type: 'property', label, value, confidence: 0.9, source }
    }

    // Vehicle
    if (/^(vehicle|car|auto|vin|make|model|year)/.test(l) && !/year built/.test(l)) {
      return { type: 'vehicle', label, value, confidence: 0.85, source }
    }

    // Generic fact
    return { type: 'fact', label, value, confidence: 0.7, source }
  }

  private extractPatterns(line: string, entities: ExtractedEntity[]): void {
    // Email addresses
    const emailMatch = line.match(/([\w.-]+@[\w.-]+\.\w+)/)
    if (emailMatch) {
      entities.push({ type: 'email', label: 'Email', value: emailMatch[1], confidence: 1.0, source: line })
    }

    // Phone numbers
    const phoneMatch = line.match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/)
    if (phoneMatch) {
      entities.push({ type: 'phone', label: 'Phone', value: phoneMatch[1], confidence: 1.0, source: line })
    }

    // Dollar amounts
    const moneyMatch = line.match(/(\$[\d,]+(?:\.\d{2})?)/)
    if (moneyMatch) {
      entities.push({ type: 'money', label: 'Amount', value: moneyMatch[1], confidence: 1.0, source: line })
    }

    // Policy numbers (common formats)
    const policyMatch = line.match(/\b([A-Z]{2,4}[-\s]?\d{4,}[-\s]?\d*)\b/)
    if (policyMatch && policyMatch[1].length > 5) {
      entities.push({ type: 'policy', label: 'Policy', value: policyMatch[1], confidence: 0.7, source: line })
    }
  }

  private deriveRelations(
    facts: Array<{ label: string; value: string }>,
    entities: ExtractedEntity[],
    relations: ExtractedRelation[]
  ): void {
    // Find the primary person (client/customer)
    const primaryPerson = entities.find(e => e.type === 'person')
    if (!primaryPerson) return

    // Link address to person
    const address = entities.find(e => e.type === 'address')
    if (address) {
      relations.push({ sourceLabel: primaryPerson.value, targetLabel: address.value, type: 'lives_at' })
    }

    // Link carrier to person
    const carrier = entities.find(e => e.type === 'organization')
    if (carrier) {
      relations.push({ sourceLabel: primaryPerson.value, targetLabel: carrier.value, type: 'insured_by' })
    }

    // Link policy to person
    const policy = entities.find(e => e.type === 'policy')
    if (policy) {
      relations.push({ sourceLabel: primaryPerson.value, targetLabel: policy.value, type: 'has_policy' })
    }

    // Link referral to person
    const referralFact = facts.find(f => /referr/i.test(f.label))
    if (referralFact) {
      relations.push({ sourceLabel: referralFact.value, targetLabel: primaryPerson.value, type: 'referred' })
    }

    // Link property details to address
    if (address) {
      const propertyEntities = entities.filter(e => e.type === 'property')
      for (const prop of propertyEntities) {
        relations.push({ sourceLabel: address.value, targetLabel: prop.value, type: 'has_attribute' })
      }
    }
  }

  private extractSections(text: string): Array<{ heading: string; body: string }> {
    const sections: Array<{ heading: string; body: string }> = []
    const lines = text.split('\n')

    let currentHeading = 'Overview'
    let currentBody: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      // Markdown headings or ALL CAPS lines
      const headingMatch = trimmed.match(/^#{1,3}\s+(.+)$/) ||
        (trimmed.length > 3 && trimmed.length < 60 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)
          ? [null, trimmed]
          : null)

      if (headingMatch) {
        if (currentBody.length > 0) {
          sections.push({ heading: currentHeading, body: currentBody.join('\n').trim() })
        }
        currentHeading = headingMatch[1]!
        currentBody = []
      } else if (trimmed) {
        currentBody.push(trimmed)
      }
    }

    if (currentBody.length > 0) {
      sections.push({ heading: currentHeading, body: currentBody.join('\n').trim() })
    }

    return sections
  }
}
