import Anthropic from '@anthropic-ai/sdk';

// Initialize the Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Generates production-quality, complete code using an automated continuation loop and streaming.
 */
export async function generateCode(prompt: string): Promise<string> {
  try {
    console.log("Starting code generation for prompt:", prompt.substring(0, 100) + "...");
    
    const initialPrompt = `You are a senior full-stack developer. Generate production-quality, complete code based on the following requirements.
    
Requirements: ${prompt}

Follow these guidelines:
- Use modern design patterns and best practices.
- Output only the complete, production-ready code without any explanations or markdown.
- Ensure the code is working and handle errors gracefully.
- Include comments where necessary to explain complex logic.
- Focus on creating a user-friendly interface if applicable.
- **IMPORTANT:** End your output with the exact token "<<<EOF>>>" when the code is complete.
- Generate line by line with proper spacing and formatting.
`;
    let generatedCode = "";
    let isComplete = false;
    let iteration = 0;
    const maxIterations = 3;
    let currentPrompt = initialPrompt;

    while (!isComplete && iteration < maxIterations) {
      console.log(`Starting iteration ${iteration + 1}...`);
      
      try {
        const response = await anthropic.messages.create(
          {
            model: "claude-3-7-sonnet-20250219",
            max_tokens: 128000,
            messages: [{
              role: "user",
              content: currentPrompt,
            }],
            stream: false
          },
          {
            headers: {
              'anthropic-beta': 'output-128k-2025-02-19'
            }
          }
        );

        let newContent = "";
        if (response.content[0].type === 'text') {
          newContent = response.content[0].text;
          console.log(`Received content of length: ${newContent.length}`);
        }

        generatedCode += newContent;
        
        if (generatedCode.includes("<<<EOF>>>")) {
          isComplete = true;
          generatedCode = generatedCode.replace("<<<EOF>>>", "").trim();
          console.log("Found EOF marker, code generation complete!");
        } else {
          const tailContext = generatedCode.slice(-300);
          currentPrompt = `Continue generating the code from the following context without repeating previously generated code.
Ensure that the final output ends with the exact token "<<<EOF>>>".
Context:
${tailContext}
`;
          console.log("Preparing for continuation...");
        }
      } catch (iterError) {
        console.error(`Error in iteration ${iteration + 1}:`, iterError);
        
        if (iteration === 0) {
          try {
            console.log("Attempting fallback...");
            const fallbackResponse = await anthropic.messages.create(
              {
                model: "claude-3-5-haiku-20240307",
                max_tokens: 128000,
                messages: [{
                  role: "user",
                  content: `Generate simple code for: ${prompt}. Keep it minimal. End with <<<EOF>>>`,
                }],
              },
              {
                headers: {
                  'anthropic-beta': 'output-128k-2025-02-19'
                }
              }
            );
            
            if (fallbackResponse.content[0].type === 'text') {
              generatedCode = fallbackResponse.content[0].text;
              if (generatedCode.includes("<<<EOF>>>")) {
                generatedCode = generatedCode.replace("<<<EOF>>>", "").trim();
              }
              isComplete = true;
              console.log("Fallback generation successful!");
            }
          } catch (fallbackError) {
            console.error("Fallback attempt failed:", fallbackError);
          }
        }
      }
      
      iteration++;
    }

    if (generatedCode && !isComplete) {
      console.log("Returning incomplete code...");
      generatedCode += "\n// Note: Code generation was incomplete";
    }
    
    if (!generatedCode) {
      console.log("No code generated, returning placeholder...");
      return "// Could not generate code for this request.";
    }

    return generatedCode;
  } catch (error) {
    console.error("Top-level code generation error:", error);
    return "// Code generation failed: " + (error instanceof Error ? error.message : "Unknown error");
  }
}

/**
 * Analyzes an error in generated code and attempts to fix it.
 * Returns the fixed code and analysis of the error.
 */
export async function analyzeError(error: string, code: string) {
  try {
    console.log("Analyzing error:", error.substring(0, 100) + "...");
    
    const response = await anthropic.messages.create(
      {
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 128000,
        messages: [{
          role: "user",
          content: `As a senior developer, fix this code that has errors. Provide a complete, working solution that follows best practices and includes proper error handling.

Error:
${error}

Code:
${code}

Requirements:
1. Fix all syntax and runtime errors.
2. Add proper error handling.
3. Follow best practices and ensure type safety.
4. Provide complete, production-ready code without any explanations.
5. Return the fixed code with "<<<FIXED_CODE>>>" at the beginning and "<<<END_FIXED_CODE>>>" at the end.
6. After the fixed code, provide a brief analysis of what was wrong with the original code.
`,
        }],
      },
      {
        headers: {
          'anthropic-beta': 'output-128k-2025-02-19'
        }
      }
    );

    let responseText = '';
    let fixedCode = '';
    let analysis = '';

    if (response.content[0].type === 'text') {
      responseText = response.content[0].text;
      console.log(`Received analysis response of length: ${responseText.length}`);
    }

    const fixedCodeMatch = responseText.match(/<<<FIXED_CODE>>>([\s\S]*?)<<<END_FIXED_CODE>>>/);
    if (fixedCodeMatch && fixedCodeMatch[1]) {
      fixedCode = fixedCodeMatch[1].trim();
      console.log("Successfully extracted fixed code");
    }

    const afterFixedCode = responseText.split('<<<END_FIXED_CODE>>>')[1];
    if (afterFixedCode) {
      analysis = afterFixedCode.trim();
    }

    return {
      fixedCode,
      analysis,
      originalError: error
    };
  } catch (error) {
    console.error("Error analysis failed:", error);
    return {
      fixedCode: "",
      analysis: "Failed to analyze error: " + (error instanceof Error ? error.message : "Unknown error"),
      originalError: error
    };
  }
}

/**
 * Creates an enhanced prompt for generating fullstack applications
 * with proper file structure and routing
 */
export function createEnhancedFullstackPrompt(userQuery: string): string {
  return `You are a senior full-stack web developer. I want you to generate a COMPLETE, WORKING web application based on my requirements. 
This must include BOTH frontend and backend code correctly organized in separate files.

USER REQUIREMENTS: ${userQuery}

IMPORTANT INSTRUCTIONS:
1. ORGANIZE CODE WITH CLEAR FILE HEADERS: 
   - Each file should be preceded by a header in this EXACT format: // ----- filepath -----
   - Example: // ----- frontend/index.html -----
   - Use frontend/ prefix for frontend files and backend/ prefix for backend files

2. CREATE A MULTI-PAGE APPLICATION with proper navigation:
   - All links must work correctly between pages
   - For static sites: Create separate HTML files for each page (index.html, menu.html, cart.html, etc.)
   - For React/Vue: Set up proper routing (React Router, Vue Router)
   - Navigation must work when hosted on a local server

3. PROVIDE COMPLETE, WORKING CODE:
   - Include ALL necessary files for a functional application
   - No placeholders or "..." shortcuts
   - Frontend: HTML, CSS, and JavaScript files
   - Backend: Complete Express.js server with necessary routes

4. CONNECTION BETWEEN FRONTEND AND BACKEND:
   - Frontend must connect to backend API running on port 3001
   - Include proper CORS configuration
   - API calls must use absolute URLs (http://localhost:3001/api/...)
   - Include working fetch/axios calls to backend endpoints

5. INCLUDE DATA PERSISTENCE:
   - Use localStorage or sessionStorage for client-side data
   - For server-side, use an in-memory data store or JSON files

6. FILE ORGANIZATION:
   - Frontend: index.html, styles.css, script.js (or equivalent framework files)
   - Backend: server.js, routes/*.js, package.json with dependencies

7. SPECIFIC REQUIREMENTS:
   - Every link and button must have a real destination or action
   - Multi-page applications must use proper routing (not just separate HTML files)
   - If data needs to be shared between pages, implement proper state management

This code will be executed in a development environment where I'll run both the frontend and backend separately.
THE MOST IMPORTANT THING is that pages correctly link to each other and work when hosted on a local server.`;
}

/**
 * Creates a prompt specifically tailored for a bakery website example
 */
export function createBakeryWebsitePrompt(): string {
  return `Generate a complete, working bakery website with multiple pages. The website should have:

1. Homepage with welcome message and featured items
2. Menu page with bakery products organized by category (breads, pastries, cakes)
3. Product detail pages for at least 3 items
4. Shopping cart page where users can see selected items
5. About us page with bakery information

The implementation should:
- Use proper navigation between all pages
- Include a persistent shopping cart that works across pages
- Store cart data in localStorage
- Have a backend API for product data
- Include images (you can use placeholder URLs)
- Have a responsive design that works on mobile and desktop

IMPORTANT: Ensure all page navigation works properly when hosted on a local web server. 
Links between pages must function correctly, not just show up in the navigation bar.`;
}

/**
 * Detects if a query is asking for a fullstack or multi-page application
 */
export function isFullstackOrMultiPageRequest(query: string): boolean {
  const fullstackPatterns = [
    'fullstack', 'full-stack', 'full stack',
    'frontend and backend', 'frontend & backend', 
    'client and server', 'client & server',
    'website with backend', 'website with api',
    'web app with server', 'web application with database',
    'multi-page', 'multiple pages', 'several pages'
  ];
  
  const query_lower = query.toLowerCase();
  
  // Check for direct mentions of fullstack or multi-page concepts
  for (const pattern of fullstackPatterns) {
    if (query_lower.includes(pattern)) {
      return true;
    }
  }
  
  // Check for mentions of different pages in the same app
  const pageTypes = ['home page', 'about page', 'contact page', 'menu page', 'product page', 
                    'cart page', 'checkout page', 'login page', 'signup page'];
  let pageTypeCount = 0;
  
  for (const pageType of pageTypes) {
    if (query_lower.includes(pageType)) {
      pageTypeCount++;
    }
  }
  
  // If they mention multiple page types, likely wants a multi-page app
  if (pageTypeCount >= 2) {
    return true;
  }
  
  // Check for combination of frontend and backend terms
  const hasFrontend = query_lower.includes('frontend') || 
                      query_lower.includes('client') || 
                      query_lower.includes('ui') ||
                      query_lower.includes('html') ||
                      query_lower.includes('css');
                      
  const hasBackend = query_lower.includes('backend') || 
                     query_lower.includes('server') || 
                     query_lower.includes('api') ||
                     query_lower.includes('database') ||
                     query_lower.includes('express');
                     
  return hasFrontend && hasBackend;
}