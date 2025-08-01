import React, { useState, useEffect, useRef } from 'react'
import { Users, X, Send, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import Portal from './Portal'
import plainService from '../services/plain'
import logger from '../utils/logger-frontend'

const initialForm = {
  name: '',
  email: '',
  description: ''
}

const FindDeveloperWidget = ({ isExpanded, onExpand, onCollapse, isAnyExpanded }) => {
  const [collapseTimeout, setCollapseTimeout] = useState(null)
  const [form, setForm] = useState(initialForm)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState(null)
  const [errors, setErrors] = useState({})
  const modalRef = useRef(null)


  // Handle click outside to collapse widget
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

  const validateForm = () => {
    const newErrors = {}
    
    if (!form.name.trim()) {
      newErrors.name = 'Name is required'
    }
    
    if (!form.email.trim()) {
      newErrors.email = 'Email is required'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      newErrors.email = 'Please enter a valid email address'
    }
    
    if (!form.description.trim()) {
      newErrors.description = 'Description is required'
    } else if (form.description.trim().length < 20) {
      newErrors.description = 'Description must be at least 20 characters'
    }
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!validateForm()) {
      return
    }
    
    setIsSubmitting(true)
    setSubmitResult(null)
    
    try {
      const result = await plainService.createTicket(
        { name: form.name, email: form.email },
        { name: form.name, email: form.email, description: form.description }
      )
      
      if (result.success) {
        setSubmitResult({
          type: 'success',
          message: 'Your developer request has been submitted successfully! We\'ll get back to you soon.',
          details: result
        })
        setForm(initialForm) // Reset form on success
      } else {
        setSubmitResult({
          type: 'error',
          message: 'Failed to submit request. Please try again.',
          details: result.error
        })
      }
    } catch (error) {
      logger.error('Error submitting developer request:', error)
      setSubmitResult({
        type: 'error',
        message: 'An unexpected error occurred. Please try again.',
        details: error.message
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }))
    }
  }

  const resetForm = () => {
    setForm(initialForm)
    setErrors({})
    setSubmitResult(null)
  }

  return (
    <>
      {/* Collapsed Floating Button for Sidebar Grouping */}
      {!isExpanded ? (
        <div
          className="relative z-50 w-16 h-16"
          onClick={onExpand}
        >
          <div className="flex flex-col items-center justify-center h-16 w-16 cursor-pointer bg-card-bg/95 border border-gray-700 rounded-r-xl shadow-2xl transition-all duration-300 hover:border-white/30 hover:shadow-[0_0_15px_rgba(255,255,255,0.3),0_0_30px_rgba(255,255,255,0.15)]">
            <Users size={24} className="text-white" />
          </div>
        </div>
      ) : (
        /* Expanded Centered Widget */
        <Portal>
          <div ref={modalRef} className="fixed z-[9999] p-4 left-1/2 top-1/2 w-[441px] bg-card-bg/50 border border-gray-800 rounded-xl shadow-lg max-h-[93.5vh] overflow-y-auto pb-6 animate-modal-enter" data-widget="find-developer">
            <button
              className="absolute top-4 right-4 z-50 text-gray-400 hover:text-white transition-all duration-200"
              onClick={onCollapse}
              aria-label="Close"
            >
              <span style={{fontSize: 20, fontWeight: 'bold', lineHeight: 1}}>×</span>
            </button>
            
            <div className="w-full h-full">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-2">
                    <Users size={20} className="text-white" />
                    <h3 className="text-white font-semibold text-sm">Find a Developer</h3>
                  </div>
                </div>

                {/* Success/Error Messages */}
                {submitResult && (
                  <div className={`mb-4 p-3 rounded-lg border ${
                    submitResult.type === 'success' 
                      ? 'bg-green-500/10 border-green-500/30 text-green-400' 
                      : 'bg-red-500/10 border-red-500/30 text-red-400'
                  }`}>
                    <div className="flex items-center space-x-2">
                      {submitResult.type === 'success' ? (
                        <CheckCircle size={20} className="text-green-400" />
                      ) : (
                        <AlertCircle size={20} className="text-red-400" />
                      )}
                      <span className="font-medium">{submitResult.message}</span>
                    </div>
                    {submitResult.details && (
                      <div className="mt-2 text-sm opacity-75">
                        {submitResult.type === 'success' ? (
                          <p>Ticket ID: {submitResult.details.thread?.id}</p>
                        ) : (
                          <p>Error: {submitResult.details}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-2">
                  <input 
                    type="text"
                    name="name" 
                    value={form.name} 
                    onChange={handleChange} 
                    placeholder="Your Name *" 
                    className="w-full bg-gray-800 text-white rounded p-2 text-xs" 
                    required 
                  />
                  {errors.name && (
                    <p className="text-xs text-red-400">{errors.name}</p>
                  )}
                  
                  <input 
                    type="email"
                    name="email" 
                    value={form.email} 
                    onChange={handleChange} 
                    placeholder="Email Address *" 
                    className="w-full bg-gray-800 text-white rounded p-2 text-xs" 
                    required 
                  />
                  {errors.email && (
                    <p className="text-xs text-red-400">{errors.email}</p>
                  )}
                  
                  <textarea 
                    name="description" 
                    value={form.description} 
                    onChange={handleChange} 
                    placeholder="Project Description * (minimum 20 characters)" 
                    className="w-full bg-gray-800 text-white rounded p-2 text-xs resize-none" 
                    rows={3}
                    required 
                    spellCheck="false"
                    autoComplete="off"
                  />
                  {errors.description && (
                    <p className="text-xs text-red-400">{errors.description}</p>
                  )}
                  
                  <button 
                    type="submit" 
                    disabled={isSubmitting}
                    className="w-full flex items-center justify-center space-x-2 group mt-4 mb-2 bg-transparent border border-white/50 text-white px-6 py-3 rounded-full font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-custom-bg hover:border-white hover:bg-white/10 hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.03)] hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]"
                  >
                    {isSubmitting ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Send size={16} />
                    )}
                    <span className="text-sm">
                      {isSubmitting ? 'Submitting...' : 'Submit Request'}
                    </span>
                  </button>
                </form>

                {/* Info Section */}
                <div className="mt-3 text-xs text-gray-300 space-y-1 border-t border-gray-700 pt-3">
                  <div className="font-semibold mb-1">What happens next:</div>
                  <ul className="space-y-0.5">
                    <li>• We'll review your request and try to match you with suitable devs</li>
                    <li>• Our team will contact you asap.</li>
                  </ul>
                </div>
              </div>
            </div>
          </Portal>
      )}
    </>
  )
}

export default FindDeveloperWidget 