// Frontend-compatible logger utility (ES6 modules)
class Logger {
  constructor() {
    this.isDevelopment = process.env.NODE_ENV !== 'production'
    this.isProduction = process.env.NODE_ENV === 'production'
  }

  // Only log in development
  log(...args) {
    if (this.isDevelopment) {
      console.log(...args)
    }
  }

  // Only warn in development
  warn(...args) {
    if (this.isDevelopment) {
      console.warn(...args)
    }
  }

  // Always log errors (important for production debugging)
  error(...args) {
    console.error(...args)
  }

  // Only log info in development
  info(...args) {
    if (this.isDevelopment) {
      console.info(...args)
    }
  }

  // Only log debug in development
  debug(...args) {
    if (this.isDevelopment) {
      console.debug(...args)
    }
  }

  // Group logs (development only)
  group(label) {
    if (this.isDevelopment) {
      console.group(label)
    }
  }

  groupEnd() {
    if (this.isDevelopment) {
      console.groupEnd()
    }
  }

  // Time operations (development only)
  time(label) {
    if (this.isDevelopment) {
      console.time(label)
    }
  }

  timeEnd(label) {
    if (this.isDevelopment) {
      console.timeEnd(label)
    }
  }

  // Conditional logging with custom conditions
  conditional(condition, ...args) {
    if (this.isDevelopment && condition) {
      console.log(...args)
    }
  }

  // Production-safe logging (always logs, but with different levels)
  productionLog(level, ...args) {
    switch (level) {
      case 'error':
        console.error(...args)
        break
      case 'warn':
        if (this.isDevelopment) {
          console.warn(...args)
        }
        break
      case 'info':
        if (this.isDevelopment) {
          console.info(...args)
        }
        break
      default:
        if (this.isDevelopment) {
          console.log(...args)
        }
    }
  }
}

// Create singleton instance
const logger = new Logger()

// Utility function to create global gradient background for screenshots
const createGlobalGradientBackground = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  // Main gradient background - exact match to CSS body background
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#1E1E1E');
  gradient.addColorStop(0.5, '#0F0F0F');
  gradient.addColorStop(1, '#1A1A1A');
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  
  // Add radial gradients overlay - exact match to CSS body::before
  // Radial gradient 1: circle at 20% 80%
  const radial1 = ctx.createRadialGradient(width * 0.2, height * 0.8, 0, width * 0.2, height * 0.8, width * 0.5);
  radial1.addColorStop(0, 'rgba(120, 119, 198, 0.1)'); // Original CSS value
  radial1.addColorStop(1, 'transparent');
  ctx.fillStyle = radial1;
  ctx.fillRect(0, 0, width, height);
  
  // Radial gradient 2: circle at 80% 20%
  const radial2 = ctx.createRadialGradient(width * 0.8, height * 0.2, 0, width * 0.8, height * 0.2, width * 0.5);
  radial2.addColorStop(0, 'rgba(255, 119, 198, 0.1)'); // Original CSS value
  radial2.addColorStop(1, 'transparent');
  ctx.fillStyle = radial2;
  ctx.fillRect(0, 0, width, height);
  
  // Radial gradient 3: circle at 40% 40%
  const radial3 = ctx.createRadialGradient(width * 0.4, height * 0.4, 0, width * 0.4, height * 0.4, width * 0.5);
  radial3.addColorStop(0, 'rgba(120, 219, 255, 0.05)'); // Original CSS value
  radial3.addColorStop(1, 'transparent');
  ctx.fillStyle = radial3;
  ctx.fillRect(0, 0, width, height);
  
  return canvas;
};

// ES6 export for frontend
export default logger;
export { Logger, createGlobalGradientBackground }; 