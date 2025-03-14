import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  Send, Trash2, Plus, MessageSquare, 
  History, RotateCcw, Loader2
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { FullstackProjectInfo } from "@/components/fullstack/FullstackProjectInfo";

// Define ChatSession type for database
type ChatSession = {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
};
let hasAutoOpenedGlobal = false;

// Define ChatMessage type for consistency
type ChatMessage = {
  id: number;
  sessionId: number;
  role: string;
  content: string;
  timestamp: string;
};

type ChatInterfaceProps = {
  code: string;
  onCodeChange: (code: string) => void;
  onOutputChange: (output: string) => void;
  onWebOutputChange: (webOutput: string) => void;
  onGeneratingChange: (isGenerating: boolean) => void;
  onSessionChange: (sessionId: number) => void;
  onRunCode: () => void;
};

export function ChatInterface({ 
  code,
  onCodeChange,
  onOutputChange,
  onWebOutputChange,
  onGeneratingChange,
  onSessionChange,
  onRunCode
}: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const [activeSessionId, setActiveSessionId] = useState<number>(1); // Default to 1
  const [generationProgress, setGenerationProgress] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [sessionInitialized, setSessionInitialized] = useState(false);
  // Add a new ref to prevent initialization loop
  const initializationInProgress = useRef(false);
  
  // Add state for fullstack project
  const [fullstackProject, setFullstackProject] = useState<{
    projectId: string;
    code: string;
    frontendUrl?: string;
    backendUrl?: string;
    projectType?: string;
    isFullstack?: boolean;
    isRunning: boolean;
  } | null>(null);

  // Get all sessions
  const { data: sessions = [], isLoading: isLoadingSessions } = useQuery<ChatSession[]>({
    queryKey: ["/api/chat/sessions"],
  });

  // Get messages for active session
  const { data: messages = [], isLoading: isLoadingMessages } = useQuery<ChatMessage[]>({
    queryKey: ["/api/chat/messages", activeSessionId],
    queryFn: async () => {
      if (!activeSessionId) return [];
      
      console.log(`Fetching messages for session ID: ${activeSessionId}`);
      const response = await apiRequest("GET", `/api/chat/messages?sessionId=${activeSessionId}`);
      return response.json();
    },
    enabled: !!activeSessionId,
  });

  // When active session changes, notify parent component
  useEffect(() => {
    if (activeSessionId) {
      console.log(`Session changed to: ${activeSessionId}`);
      onSessionChange(activeSessionId);
    }
  }, [activeSessionId, onSessionChange]);

  // Auto-select first session or create new one if none exists
  useEffect(() => {
    // Use the ref to prevent infinite loops
    if (!isLoadingSessions && !sessionInitialized && !initializationInProgress.current) {
      // Type guard to ensure sessions is an array
      const sessionsArray = Array.isArray(sessions) ? sessions : [];
      
      if (sessionsArray.length > 0) {
        console.log(`Setting active session to first available: ${sessionsArray[0].id}`);
        setActiveSessionId(sessionsArray[0].id);
        setSessionInitialized(true);
      } else if (!initializationInProgress.current) {
        console.log("No sessions found, creating default session");
        // Set flag to prevent multiple creations
        initializationInProgress.current = true;
        createSession.mutate({ name: "Default Chat" }, {
          onSuccess: () => {
            setSessionInitialized(true);
            initializationInProgress.current = false;
          },
          onError: () => {
            initializationInProgress.current = false;
          }
        });
      }
    }
  }, [sessions, isLoadingSessions, sessionInitialized]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const createSession = useMutation({
    mutationFn: async (data: { name: string }) => {
      console.log("Creating new session:", data.name);
      return apiRequest("POST", "/api/chat/sessions", { title: data.name });
    },
    onSuccess: async (response) => {
      const session = await response.json();
      console.log("Session created successfully:", session.id);
      setActiveSessionId(session.id);
      queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
      toast({
        title: "New chat created",
        description: "You can now start a new conversation",
      });
    },
    onError: (error: Error) => {
      console.error("Error creating session:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create new chat",
        variant: "destructive"
      });
    }
  });

  const sendMessage = useMutation({
    mutationFn: async (content: string) => {
      if (!activeSessionId) {
        console.error("No active session when sending message");
        throw new Error("No active session");
      }
      
      console.log(`Sending message with sessionId: ${activeSessionId}`);
      return apiRequest("POST", `/api/chat/messages`, {
        sessionId: activeSessionId,
        role: "user",
        content
      });
    },
    onSuccess: async (response) => {
      setInput("");
      
      // Parse the response to check if code was generated
      const responseData = await response.json();
      
      // Invalidate the messages query to refresh the chat
      queryClient.invalidateQueries({ queryKey: ["/api/chat/messages", activeSessionId] });
      
      // If code was generated, update the editor
      if (responseData.isCodeRequest && responseData.code) {
        // Update code editor
        onCodeChange(responseData.code);
        
        // Set generating state temporarily to show progress
        setIsGeneratingCode(true);
        onGeneratingChange(true);
        
        // Execute the code automatically
        executeGeneratedCode(responseData.code);
        hasAutoOpenedGlobal = false;  // Reset the flag for new code
        window.console.log('[ChatInterface] Reset hasAutoOpenedGlobal for new code generation');
      }
    },
    onError: (error: Error) => {
      console.error("Error sending message:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to send message",
        variant: "destructive"
      });
    }
  });

const executeGeneratedCode = async (generatedCode: string) => {
  try {
    window.console.log('[ChatInterface] executeGeneratedCode called, code length:', generatedCode.length);
    window.console.log('[ChatInterface] Current hasAutoOpenedGlobal value:', hasAutoOpenedGlobal);
    
    const codeType = generatedCode.includes('document') || 
                     generatedCode.includes('<html') || 
                     generatedCode.includes('window.') ? 'web' : 'node';
    
    const response = await fetch("/api/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: generatedCode })
    });
    
    const result = await response.json();
    window.console.log('[ChatInterface] Execute result:', {
      hasOutput: !!result.output,
      hasWebOutput: !!result.webOutput,
      hasPreviewUrl: !!result.previewUrl
    });
    
    if (result.output) {
      onOutputChange(result.output);
    }
    
    if (result.webOutput) {
      onWebOutputChange(result.webOutput);
      
      // Only auto-open if this is the first time for this generation
      if (!hasAutoOpenedGlobal) {
        window.console.log('[ChatInterface] Auto-opening preview in new tab');
        setTimeout(() => {
          const previewUrl = result.previewUrl || `data:text/html;charset=utf-8,${encodeURIComponent(result.webOutput)}`;
          window.open(previewUrl, '_blank', 'noopener,noreferrer');
          // Mark as opened
          hasAutoOpenedGlobal = true;
        }, 100);
      } else {
        window.console.log('[ChatInterface] Skipping auto-open because hasAutoOpenedGlobal is true');
      }
    }
    
    // Signal code execution is complete
    setTimeout(() => {
      setIsGeneratingCode(false);
      onGeneratingChange(false);
    }, 500);
    
    // If there was an error, try to fix it automatically
    if (result.error) {
      fixCodeError(generatedCode, result.error);
    }
  } catch (error) {
    window.console.error('[ChatInterface] Error executing code:', error);
    setIsGeneratingCode(false);
    onGeneratingChange(false);
    
    toast({
      title: "Error executing code",
      description: error instanceof Error ? error.message : "Failed to execute code",
      variant: "destructive"
    });
  }
};

  const fixCodeError = async (brokenCode: string, errorMessage: string) => {
    try {
      setIsGeneratingCode(true);
      onGeneratingChange(true);
      
      const response = await fetch("/api/analyze-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          code: brokenCode,
          error: errorMessage 
        })
      });
      
      const result = await response.json();
      
      if (result.fixedCode) {
        // Update the editor with fixed code
        onCodeChange(result.fixedCode);
        
        // Execute the fixed code
        executeGeneratedCode(result.fixedCode);
        
        toast({
          title: "Code fixed automatically",
          description: "The code had errors, but they were fixed automatically.",
        });
      } else {
        setIsGeneratingCode(false);
        onGeneratingChange(false);
        
        toast({
          title: "Code error",
          description: "The code has errors that couldn't be fixed automatically.",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error("Error fixing code:", error);
      setIsGeneratingCode(false);
      onGeneratingChange(false);
      
      toast({
        title: "Error fixing code",
        description: error instanceof Error ? error.message : "Failed to fix code errors",
        variant: "destructive"
      });
    }
  };

  const clearSession = useMutation({
    mutationFn: async () => {
      if (!activeSessionId) return null;
      console.log(`Clearing messages for session: ${activeSessionId}`);
      return apiRequest("DELETE", `/api/chat/sessions/${activeSessionId}/messages`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/messages", activeSessionId] });
      toast({
        title: "Chat cleared",
        description: "All messages in this chat have been cleared"
      });
      
      // Also clear the code
      onCodeChange("");
      onOutputChange("");
      onWebOutputChange("");
      
      // Reset fullstack project if any
      setFullstackProject(null);
    },
    onError: (error: Error) => {
      console.error("Error clearing session:", error);
      toast({
        title: "Error",
        description: "Failed to clear chat messages",
        variant: "destructive"
      });
    }
  });

  const deleteSession = useMutation({
    mutationFn: async () => {
      if (!activeSessionId) return null;
      
      console.log(`Deleting session: ${activeSessionId}`);
      return apiRequest("DELETE", `/api/chat/sessions/${activeSessionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
      // Set initialized to false but don't trigger a session creation right away
      setSessionInitialized(false);
      toast({
        title: "Chat deleted",
        description: "The chat has been deleted"
      });
      
      // Clear code when deleting a session
      onCodeChange("");
      onOutputChange("");
      onWebOutputChange("");
      
      // Reset fullstack project if any
      setFullstackProject(null);
    },
    onError: (error: Error) => {
      console.error("Error deleting session:", error);
      toast({
        title: "Error",
        description: "Failed to delete chat",
        variant: "destructive"
      });
    }
  });

  // Function to detect fullstack or multi-page application request
  const isFullstackOrMultiPageRequest = (query: string): boolean => {
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
  };

  // Handle fullstack generation 
  const handleFullstackGeneration = async (prompt: string) => {
    try {
      setIsGeneratingCode(true);
      onGeneratingChange(true);
      
      // Save user message to chat
      await apiRequest("POST", `/api/chat/messages`, {
        sessionId: activeSessionId,
        role: "user",
        content: prompt
      });
      
      queryClient.invalidateQueries({ queryKey: ["/api/chat/messages", activeSessionId] });
      
      // Generate code with the enhanced prompt
      const response = await fetch("/api/generate-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          type: "fullstack"
        }),
      });
      
      if (!response.ok) {
        throw new Error("Failed to generate code");
      }
      
      const result = await response.json();
      const generatedCode = result.code;
      
      // Update code editor
      onCodeChange(generatedCode);
      
      // Create fullstack project
      const createResponse = await fetch("/api/fullstack/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: generatedCode,
        }),
      });
      
      if (!createResponse.ok) {
        throw new Error("Failed to create project");
      }
      
      const createResult = await createResponse.json();
      
      // Add assistant message
      await apiRequest("POST", `/api/chat/messages`, {
        sessionId: activeSessionId,
        role: "assistant",
        content: `I've created a ${createResult.isFullstack ? 'fullstack' : createResult.projectType} application with ${createResult.fileCount} files. The project has been set up with proper routing between pages.

To run the application:
1. Click the "Start" button below
2. Open the frontend URL in your browser
3. Navigate through the pages using the links/menu

The application includes:
- ${createResult.isFullstack ? 'Frontend and backend components' : 'Multiple connected pages'}
- Proper routing and navigation
- ${createResult.isFullstack ? 'API endpoints and connectivity' : 'Data persistence between pages'}

You can view the file structure, server logs, and other details in the tabs below.`
      });
      
      // Store project info
      setFullstackProject({
        projectId: createResult.projectId,
        code: generatedCode,
        projectType: createResult.projectType,
        isFullstack: createResult.isFullstack,
        isRunning: false
      });
      
      // Refresh messages
      queryClient.invalidateQueries({ queryKey: ["/api/chat/messages", activeSessionId] });
      
      toast({
        title: "Project Created",
        description: "Your multi-page application has been created and is ready to run.",
      });
    } catch (error) {
      console.error("Error handling fullstack request:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to process fullstack request",
        variant: "destructive"
      });
      
      // Add error message
      await apiRequest("POST", `/api/chat/messages`, {
        sessionId: activeSessionId,
        role: "assistant",
        content: "I'm sorry, I encountered an error while creating your fullstack application. Please try again with more specific requirements."
      });
      
      queryClient.invalidateQueries({ queryKey: ["/api/chat/messages", activeSessionId] });
    } finally {
      setIsGeneratingCode(false);
      onGeneratingChange(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      // Check if this is a fullstack or multi-page request
      if (isFullstackOrMultiPageRequest(input)) {
        handleFullstackGeneration(input);
        setInput("");
        return;
      }
      
      console.log(`Submitting message for session: ${activeSessionId}`);
      sendMessage.mutate(input.trim());
    }
  };

  const handleNewChat = () => {
    createSession.mutate({ name: "Default Chat" });
  };

  const handleSelectSession = (sessionId: number) => {
    console.log(`Manual selection of session: ${sessionId}`);
    setActiveSessionId(sessionId);
  };

  // Safely render sessions in dropdown, accounting for field name
  const getSessionDisplayName = (session: ChatSession): string => {
    // Handle the 'name' vs 'title' field issue
    return session.title || (session as any).name || `Session ${session.id}`;
  };

  // Type guard function to ensure typesafe operations on sessions and messages
  const isArrayWithItems = <T,>(data: unknown): data is T[] => {
    return Array.isArray(data) && data.length > 0;
  };

  // Get session by ID safely
  const getSessionById = (id: number): ChatSession | undefined => {
    if (!Array.isArray(sessions)) return undefined;
    return sessions.find(s => s.id === id);
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="p-3 border-b flex flex-row justify-between items-center space-y-0">
        <div className="flex gap-2 items-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
              >
                <MessageSquare className="h-4 w-4" />
                {getSessionById(activeSessionId) 
                  ? getSessionDisplayName(getSessionById(activeSessionId)!) 
                  : "Select Chat"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {Array.isArray(sessions) && sessions.map((session: ChatSession) => (
                <DropdownMenuItem
                  key={session.id}
                  className={`flex items-center gap-2 ${session.id === activeSessionId ? 'bg-muted' : ''}`}
                  onClick={() => handleSelectSession(session.id)}
                >
                  <MessageSquare className="h-4 w-4" />
                  <span className="truncate">{getSessionDisplayName(session)}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem className="flex items-center gap-2 text-primary" onClick={handleNewChat}>
                <Plus className="h-4 w-4" />
                <span>New Chat</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNewChat}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => clearSession.mutate()}
            disabled={!activeSessionId || !isArrayWithItems<ChatMessage>(messages) || messages.length === 0}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => deleteSession.mutate()}
            disabled={!activeSessionId}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-0 overflow-hidden">
        <ScrollArea className="h-full p-4" ref={scrollRef as any}>
          {isLoadingMessages ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="animate-pulse h-20 bg-muted rounded" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {!isArrayWithItems<ChatMessage>(messages) && (
                <div className="text-center text-muted-foreground py-8">
                  <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <h3 className="text-lg font-medium">No messages yet</h3>
                  <p className="text-sm">Start a conversation to generate code</p>
                </div>
              )}
              {Array.isArray(messages) && messages.map((message: ChatMessage) => (
                <div
                  key={message.id}
                  className={`p-3 rounded-lg ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground ml-8"
                      : "bg-muted mr-8"
                  }`}
                >
                  <div className="text-xs text-muted-foreground mb-1">
                    {message.role === "user" ? "You" : "Assistant"}
                  </div>
                  <div className="whitespace-pre-wrap">{message.content}</div>
                </div>
              ))}
            </div>
          )}
          {isGeneratingCode && (
            <div className="mt-4">
              <div className="flex justify-between mb-2">
                <span className="text-sm text-muted-foreground">Generating code...</span>
                <span className="text-sm font-medium">{generationProgress}%</span>
              </div>
              <Progress value={generationProgress} />
            </div>
          )}
          
          {fullstackProject && (
            <FullstackProjectInfo 
              projectId={fullstackProject.projectId}
              code={fullstackProject.code}
              frontendUrl={fullstackProject.frontendUrl}
              backendUrl={fullstackProject.backendUrl}
              projectType={fullstackProject.projectType}
              isFullstack={fullstackProject.isFullstack}
              isRunning={fullstackProject.isRunning}
              onStart={async () => {
                try {
                  const response = await fetch(`/api/fullstack/start/${fullstackProject.projectId}`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    }
                  });
                  
                  if (!response.ok) {
                    throw new Error("Failed to start project");
                  }
                  
                  const result = await response.json();
                  
                  setFullstackProject({
                    ...fullstackProject,
                    frontendUrl: result.frontendUrl,
                    backendUrl: result.backendUrl,
                    isRunning: true
                  });
                  
                  // Open the project in a new tab
                  window.open(result.frontendUrl, '_blank');
                  
                  toast({
                    title: "Project Started",
                    description: "Your application is now running and has been opened in a new tab.",
                  });
                } catch (error) {
                  console.error("Error starting project:", error);
                  toast({
                    title: "Error",
                    description: error instanceof Error ? error.message : "Failed to start project",
                    variant: "destructive"
                  });
                }
              }}
              onStop={async () => {
                try {
                  await fetch(`/api/fullstack/stop/${fullstackProject.projectId}`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    }
                  });
                  
                  setFullstackProject({
                    ...fullstackProject,
                    isRunning: false
                  });
                  
                  toast({
                    title: "Project Stopped",
                    description: "Your application has been stopped.",
                  });
                } catch (error) {
                  console.error("Error stopping project:", error);
                  toast({
                    title: "Error",
                    description: error instanceof Error ? error.message : "Failed to stop project",
                    variant: "destructive"
                  });
                }
              }}
              onCleanup={async () => {
                try {
                  await fetch(`/api/fullstack/cleanup/${fullstackProject.projectId}`, {
                    method: "DELETE",
                    headers: {
                      "Content-Type": "application/json",
                    }
                  });
                  
                  setFullstackProject(null);
                  
                  toast({
                    title: "Project Deleted",
                    description: "Your application has been deleted.",
                  });
                } catch (error) {
                  console.error("Error cleaning up project:", error);
                  toast({
                    title: "Error",
                    description: error instanceof Error ? error.message : "Failed to clean up project",
                    variant: "destructive"
                  });
                }
              }}
            />
          )}
        </ScrollArea>
      </CardContent>

      <CardFooter className="p-3 border-t">
        <form onSubmit={handleSubmit} className="flex gap-2 w-full">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            disabled={sendMessage.isPending || !activeSessionId || isGeneratingCode}
            className="flex-1"
          />
          <Button 
            type="submit" 
            disabled={sendMessage.isPending || !input.trim() || !activeSessionId || isGeneratingCode}
            size="icon"
          >
            {isGeneratingCode ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}