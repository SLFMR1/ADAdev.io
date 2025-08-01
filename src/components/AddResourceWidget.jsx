import React, { useState, useEffect, useRef } from 'react'
import { Plus, ExternalLink, Github, AlertCircle, CheckCircle, Copy } from 'lucide-react'
import Portal from './Portal'

const initialForm = {
  name: '',
  logo: '',
  description: '',
  fullDescription: '',
  keySolutions: '', // comma-separated
  website: '',
  github: '',
  discord: '',
  x: '',
  docs: '',
  category: '',
  customTabTitle: '',
  customTabContent: '',
  resourceType: 'organization' // 'organization' or 'repository'
}

const AddResourceWidget = ({ isExpanded, onExpand, onCollapse, isAnyExpanded }) => {
  const [collapseTimeout, setCollapseTimeout] = useState(null)
  const [form, setForm] = useState(initialForm)
  const [codeSnippet, setCodeSnippet] = useState('')
  const [customCategory, setCustomCategory] = useState('')
  const [showInstructions, setShowInstructions] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  const modalRef = useRef(null)


  // Handle click outside to collapse widget (only when modal is open)
  useEffect(() => {
    if (!isExpanded) return
    const handleClickOutside = (event) => {
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        if (collapseTimeout) {
          clearTimeout(collapseTimeout)
          setCollapseTimeout(null)
        }
        onCollapse()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isExpanded, collapseTimeout, onCollapse])

  // Parse GitHub URL to extract organization and repository
  const parseGitHubUrl = (url) => {
    if (!url || !url.includes('github.com/')) return null
    
    const match = url.match(/github\.com\/([^\/]+)(?:\/([^\/]+))?/)
    if (!match) return null
    
    const organization = match[1]
    const repository = match[2] || null
    
    return { organization, repository }
  }

  // Generate code snippet
  const generateSnippet = () => {
    const {
      name, logo, description, fullDescription, keySolutions, website, github, discord, x, docs, category, customTabTitle, customTabContent, resourceType
    } = form
    
    // Parse GitHub URL to determine organization and repository
    const githubInfo = parseGitHubUrl(github)
    const isOrganization = resourceType === 'organization' || (githubInfo && !githubInfo.repository)
    const isRepository = resourceType === 'repository' || (githubInfo && githubInfo.repository)
    
    let obj = {
      id: '[next available id]',
      name,
      logo,
      description,
      fullDescription,
      keySolutions: keySolutions.split(',').map(s => s.trim()).filter(Boolean),
      website,
      social: {},
      category: customCategory || category
    }
    
    // Add GitHub metadata
    if (githubInfo) {
      obj.type = isRepository ? 'repository' : 'organization'
      obj.organization = githubInfo.organization
      obj.repository = isRepository ? githubInfo.repository : null
      obj.repo_path = isRepository ? `${githubInfo.organization}/${githubInfo.repository}` : githubInfo.organization
    } else {
      // Fallback if no GitHub URL
      obj.type = resourceType
      obj.organization = null
      obj.repository = null
      obj.repo_path = null
    }
    
    if (github) obj.social.github = github
    if (discord) obj.social.discord = discord
    if (x) obj.social.x = x
    if (docs) obj.docs = docs
    if (customTabTitle && customTabContent) {
      obj.customTab = { title: customTabTitle, content: customTabContent }
    }
    // Remove empty social
    if (Object.keys(obj.social).length === 0) delete obj.social
    // Format as JS
    return JSON.stringify(obj, null, 2)
      .replace(/"([^\"]+)":/g, '$1:') // remove quotes from keys
      .replace(/"/g, '"')
  }

  // Generate PR template
  const generatePRTemplate = (snippet) => {
    return `## New Resource Submission\n\nPlease review and copy the code snippet below into resources.js.\n\n\`\`\`javascript\n${snippet}\`\`\`\n\n---\n\n### Guidelines:\n- Ensure the resource is Cardano-related\n- Provide accurate and up-to-date information\n- Key Solutions should be a comma-separated list of keywords that describe the resource\n- Include all available social links\n- Use appropriate category\n- Ensure logo URL is accessible\n- GitHub metadata (type, organization, repository, repo_path) is auto-generated from the GitHub URL\n\nThank you for contributing to the Cardano developer ecosystem!`
  }

  // Handle form change
  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
  }

  // Handle form submit
  const handleSubmit = (e) => {
    e.preventDefault()
    const snippet = generateSnippet()
    setCodeSnippet(snippet)
    setShowInstructions(true)
    
    // Scroll to the PR snippet after a short delay to ensure it's rendered
    setTimeout(() => {
      const snippetElement = document.querySelector('[data-widget="add-resource"] pre')
      if (snippetElement) {
        snippetElement.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'start' 
        })
      }
    }, 100)
  }

  // Copy PR template to clipboard
  const handleCopy = async () => {
    const prTemplate = generatePRTemplate(codeSnippet)
    try {
      await navigator.clipboard.writeText(prTemplate)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 1500)
    } catch {
      setCopySuccess(false)
    }
  }

  const categories = [
    "Libraries & Languages",
    "Infrastructure & APIs",
    "Minting and NFTs",
    "Security & Auditing",
    "Analytics & Data",
    "Education & Documentation",
    "Wallets & User Tools",
    "Identity & Authentication",
    "Oracles & External Data",
    "Privacy & Zero-Knowledge",
    "AI & Machine Learning",
    "Development Platforms",
    "Community & Engagement",
    "Core Infrastructure",
    "Layer 2 Scaling Solutions",
    "Governance & DAOs"
  ]

  return (
    <>
      {/* Collapsed Floating Button for Sidebar Grouping */}
      {!isExpanded ? (
        <div
          className="relative z-50 w-16 h-16"
          onClick={onExpand}
        >
          <div className="flex flex-col items-center justify-center h-16 w-16 cursor-pointer bg-card-bg/95 border border-gray-700 rounded-r-xl shadow-2xl">
            <Plus size={24} className="text-emerald-400" />
          </div>
        </div>
      ) : (
        /* Expanded Centered Widget */
        <Portal>
          <div ref={modalRef} className="fixed z-[9999] p-4 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[441px] bg-card-bg/50 border border-gray-800 rounded-xl shadow-lg max-h-[93.5vh] overflow-y-auto pb-6 transition-all duration-700 ease-out opacity-100 scale-100" data-widget="add-resource">
              <button
                className="absolute top-4 right-4 z-50 text-gray-400 hover:text-white transition-all duration-200"
                onClick={onCollapse}
                aria-label="Close"
              >
                <span style={{fontSize: 20, fontWeight: 'bold', lineHeight: 1}}>×</span>
              </button>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-2">
                    <Plus size={20} className="text-emerald-400" />
                    <h3 className="text-white font-semibold text-sm">Add Resource</h3>
                  </div>
                </div>
                <form onSubmit={handleSubmit} className="space-y-2">
                  <input name="name" value={form.name} onChange={handleChange} placeholder="Name" className="w-full bg-gray-800 text-white rounded p-2 text-xs" required />
                  <input name="logo" value={form.logo} onChange={handleChange} placeholder="Logo URL" className="w-full bg-gray-800 text-white rounded p-2 text-xs" required />
                  <input name="description" value={form.description} onChange={handleChange} placeholder="Short Description" className="w-full bg-gray-800 text-white rounded p-2 text-xs" required />
                  <textarea name="fullDescription" value={form.fullDescription} onChange={handleChange} placeholder="Full Description" className="w-full bg-gray-800 text-white rounded p-2 text-xs" required />
                  <input name="keySolutions" value={form.keySolutions} onChange={handleChange} placeholder="Key Solutions (comma separated)" className="w-full bg-gray-800 text-white rounded p-2 text-xs" required />
                  <input name="website" value={form.website} onChange={handleChange} placeholder="Website" className="w-full bg-gray-800 text-white rounded p-2 text-xs" required />
                  <input name="github" value={form.github} onChange={handleChange} placeholder="GitHub URL" className="w-full bg-gray-800 text-white rounded p-2 text-xs" />
                  <select name="resourceType" value={form.resourceType} onChange={handleChange} className="w-full bg-gray-800 text-white rounded p-2 text-xs">
                    <option value="organization">Organization (e.g., github.com/org-name)</option>
                    <option value="repository">Repository (e.g., github.com/org-name/repo-name)</option>
                  </select>
                  <input name="discord" value={form.discord} onChange={handleChange} placeholder="Discord URL" className="w-full bg-gray-800 text-white rounded p-2 text-xs" />
                  <input name="x" value={form.x} onChange={handleChange} placeholder="X (Twitter) URL" className="w-full bg-gray-800 text-white rounded p-2 text-xs" />
                  <input name="docs" value={form.docs} onChange={handleChange} placeholder="Docs URL" className="w-full bg-gray-800 text-white rounded p-2 text-xs" />
                  <select name="category" value={form.category} onChange={e => {
                    handleChange(e)
                    if (e.target.value !== 'Other') setCustomCategory('')
                  }} className="w-full bg-gray-800 text-white rounded p-2 text-xs" required>
                    <option value="" disabled>Select Category</option>
                    {categories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                    <option value="Other">Other</option>
                  </select>
                  {form.category === 'Other' && (
                    <input
                      name="customCategory"
                      value={customCategory}
                      onChange={e => setCustomCategory(e.target.value)}
                      placeholder="Enter custom category"
                      className="w-full bg-gray-800 text-white rounded p-2 text-xs"
                      required
                    />
                  )}
                  <input name="customTabTitle" value={form.customTabTitle} onChange={handleChange} placeholder="Custom Tab Title (optional)" className="w-full bg-gray-800 text-white rounded p-2 text-xs" />
                  <textarea name="customTabContent" value={form.customTabContent} onChange={handleChange} placeholder="Custom Tab Content (optional)" className="w-full bg-gray-800 text-white rounded p-2 text-xs" />
                  <button type="submit" className="w-full flex items-center justify-center space-x-2 group mt-4 mb-2 bg-transparent border border-white/50 text-white px-6 py-3 rounded-full font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-custom-bg hover:border-white hover:bg-white/10 hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.03)] hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]"> <Github size={16} />
                    <span className="text-sm">Create Pull Request</span>
                  </button>
                </form>
                {codeSnippet && (
                  <div className="mt-4">
                    <div className="text-xs text-gray-400 mb-1 flex items-center justify-between">
                      <span>Prefilled PR Template:</span>
                      <button onClick={handleCopy} title="Copy PR template" className="ml-2 p-1 rounded hover:bg-gray-700 transition-all duration-200 border border-gray-600/50 hover:border-gray-500">
                        {copySuccess ? <CheckCircle size={16} className="text-emerald-400" /> : <Copy size={16} />}
                      </button>
                    </div>
                    <pre className="bg-gray-900/80 text-gray-200 rounded p-2 text-xs overflow-x-auto whitespace-pre-wrap"><code>{generatePRTemplate(codeSnippet)}</code></pre>
                  </div>
                )}
                {showInstructions && (
                  <div className="mt-3 text-xs text-gray-300 space-y-1 border-t border-gray-700 pt-3">
                    <div className="font-semibold mb-1">Next steps:</div>
                    <ol className="list-decimal list-inside space-y-0.5">
                      <li>Fork repo <a href="https://github.com/SLFMR1/ADAdev.io/fork" target="_blank" rel="noopener noreferrer" className="text-emerald-400 underline">(link)</a></li>
                      <li>Add to <span className="font-mono">resources.js</span></li>
                      <li>Push</li>
                      <li>Open PR</li>
                    </ol>
                  </div>
                )}
              </div>
            </Portal>
        )}
    </>
  )
}

export default AddResourceWidget 