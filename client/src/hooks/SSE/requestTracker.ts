// requestTracker.ts
export interface TrackedRequest {
    id: string;
    questionNumber: number;
    question: string;
    model: string;
    isComparison: boolean;
    panel: 'LEFT' | 'RIGHT' | 'SINGLE';
    conversationId: string;
    startTime: number;
    messageId?: string;
    status: 'pending' | 'success' | 'failed';
    responseLength?: number;
    error?: string;
    duration?: number;
    mode: 'single' | 'comparison';
    relatedRequestId?: string;
  }
  
  export const REQUEST_TRACKER = {
    activeRequests: new Map<string, TrackedRequest>(),
    completedRequests: new Map<string, TrackedRequest>(),
    questionCounter: new Map<string, number>(),
    comparisonPairs: new Map<string, string[]>(),
    
    startRequest(submission: any, isAddedRequest: boolean, runIndex: number, comparisonMode: boolean = false): string {
      const conversationId = submission.conversation?.conversationId || 'unknown';
      const isComparison = isAddedRequest && comparisonMode;
      
      const requestId = `${isComparison ? 'COMP' : (comparisonMode ? 'MAIN' : 'SINGLE')}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      let panel: 'LEFT' | 'RIGHT' | 'SINGLE';
      if (!comparisonMode) {
        panel = 'SINGLE';
      } else {
        panel = isComparison ? 'RIGHT' : 'LEFT';
      }
      
      let questionNumber: number;
      if (!isAddedRequest || !comparisonMode) {
        const currentCount = this.questionCounter.get(conversationId) || 0;
        questionNumber = currentCount + 1;
        this.questionCounter.set(conversationId, questionNumber);
      } else {
        const lastMainRequest = Array.from(this.activeRequests.values())
          .concat(Array.from(this.completedRequests.values()))
          .filter(r => r.conversationId === conversationId && r.panel === 'LEFT')
          .sort((a, b) => b.startTime - a.startTime)[0];
        questionNumber = lastMainRequest?.questionNumber || 1;
      }
      
      const request: TrackedRequest = {
        id: requestId,
        questionNumber,
        question: submission.userMessage?.text || 'unknown',
        model: submission.conversation?.model || 'unknown',
        isComparison,
        panel,
        conversationId,
        startTime: Date.now(),
        messageId: submission.initialResponse?.messageId,
        status: 'pending',
        mode: comparisonMode ? 'comparison' : 'single'
      };
      
      this.activeRequests.set(requestId, request);
      
      if (comparisonMode) {
        const pairKey = `${conversationId}-Q${questionNumber}`;
        if (!this.comparisonPairs.has(pairKey)) {
          this.comparisonPairs.set(pairKey, []);
        }
        this.comparisonPairs.get(pairKey)!.push(requestId);
        
        const relatedRequests = this.comparisonPairs.get(pairKey)!;
        if (relatedRequests.length > 1) {
          request.relatedRequestId = relatedRequests[0];
          const firstRequest = this.activeRequests.get(relatedRequests[0]) || 
                             this.completedRequests.get(relatedRequests[0]);
          if (firstRequest) {
            firstRequest.relatedRequestId = requestId;
          }
        }
      }
      
      console.log(`🚀 [REQUEST START] #${questionNumber} - ${panel} ${comparisonMode ? 'Mode' : 'Panel'}`, {
        requestId,
        model: request.model,
        question: request.question,
        mode: request.mode,
        panel: request.panel,
        isComparison: request.isComparison,
        activeRequests: this.activeRequests.size,
        relatedRequestId: request.relatedRequestId
      });
      
      this.showCurrentState();
      
      return requestId;
    },
    
    updateRequest(requestId: string, updates: Partial<TrackedRequest>) {
      const request = this.activeRequests.get(requestId) || this.completedRequests.get(requestId);
      if (!request) {
        console.warn(`⚠️ [REQUEST TRACKER] Unknown request ID: ${requestId}`);
        return;
      }
      
      Object.assign(request, updates);
      
      console.log(`📝 [REQUEST UPDATE] #${request.questionNumber} - ${request.panel} ${request.mode === 'single' ? 'Mode' : 'Panel'}`, {
        requestId,
        updates,
        currentStatus: request.status,
        mode: request.mode
      });
    },
    
    completeRequest(requestId: string, success: boolean, responseLength: number = 0, error?: string) {
      const request = this.activeRequests.get(requestId);
      if (!request) {
        console.warn(`⚠️ [REQUEST TRACKER] Cannot complete unknown request: ${requestId}`);
        return;
      }
      
      // Consider it a failure if response is empty for certain models
      if (responseLength === 0 && ['DeFacts', 'DeNews', 'DeResearch'].includes(request.model)) {
        success = false;
        error = error || 'Empty response received';
      }
      
      request.status = success ? 'success' : 'failed';
      request.responseLength = responseLength;
      request.error = error;
      request.duration = Date.now() - request.startTime;
      
      this.activeRequests.delete(requestId);
      this.completedRequests.set(requestId, request);
      
      const emoji = success ? '✅' : '❌';
      const modeText = request.mode === 'single' ? 'SINGLE MODE' : `${request.panel} Panel`;
      
      console.log(`${emoji} [REQUEST COMPLETE] #${request.questionNumber} - ${modeText}`, {
        requestId,
        model: request.model,
        question: request.question.substring(0, 50),
        success,
        responseLength,
        duration: `${request.duration}ms`,
        error,
        mode: request.mode,
        relatedRequestId: request.relatedRequestId
      });
      
      if (request.mode === 'comparison' && request.relatedRequestId) {
        const relatedRequest = this.completedRequests.get(request.relatedRequestId);
        if (relatedRequest) {
          this.logComparisonComplete(request, relatedRequest);
        }
      }
      
      this.showCurrentState();
      this.showSummary();
    },
    
    logComparisonComplete(req1: TrackedRequest, req2: TrackedRequest) {
      const leftReq = req1.panel === 'LEFT' ? req1 : req2;
      const rightReq = req1.panel === 'RIGHT' ? req1 : req2;
      
      console.log(`🔄 [COMPARISON COMPLETE] Question #${leftReq.questionNumber}`, {
        question: leftReq.question.substring(0, 50),
        LEFT: {
          model: leftReq.model,
          success: leftReq.status === 'success',
          responseLength: leftReq.responseLength,
          duration: leftReq.duration
        },
        RIGHT: {
          model: rightReq.model,
          success: rightReq.status === 'success',
          responseLength: rightReq.responseLength,
          duration: rightReq.duration
        }
      });
    },
    
    findRequestByMessageId(messageId: string): TrackedRequest | undefined {
      for (const [id, request] of this.activeRequests) {
        if (request.messageId === messageId) {
          return request;
        }
      }
      for (const [id, request] of this.completedRequests) {
        if (request.messageId === messageId) {
          return request;
        }
      }
      return undefined;
    },
    
    showCurrentState() {
      const active = Array.from(this.activeRequests.values());
      const singleMode = active.filter(r => r.mode === 'single');
      const comparisonMode = active.filter(r => r.mode === 'comparison');
      
      console.log('📊 [CURRENT STATE]', {
        totalActive: this.activeRequests.size,
        singleMode: singleMode.map(r => ({
          model: r.model,
          question: r.question.substring(0, 30),
          status: r.status
        })),
        comparisonMode: {
          left: comparisonMode.filter(r => r.panel === 'LEFT').map(r => ({
            model: r.model,
            question: r.question.substring(0, 30),
            status: r.status
          })),
          right: comparisonMode.filter(r => r.panel === 'RIGHT').map(r => ({
            model: r.model,
            question: r.question.substring(0, 30),
            status: r.status
          }))
        }
      });
    },
    
    showSummary() {
      const completed = Array.from(this.completedRequests.values());
      const singleRequests = completed.filter(r => r.mode === 'single');
      const comparisonRequests = completed.filter(r => r.mode === 'comparison');
      
      console.log('📈 [SESSION SUMMARY]', {
        totalQuestions: this.questionCounter.size > 0 ? 
          Math.max(...Array.from(this.questionCounter.values())) : 0,
        singleMode: {
          total: singleRequests.length,
          successful: singleRequests.filter(r => r.status === 'success').length,
          failed: singleRequests.filter(r => r.status === 'failed').length,
          models: [...new Set(singleRequests.map(r => r.model))]
        },
        comparisonMode: {
          totalPairs: this.comparisonPairs.size,
          LEFT: {
            total: comparisonRequests.filter(r => r.panel === 'LEFT').length,
            successful: comparisonRequests.filter(r => r.panel === 'LEFT' && r.status === 'success').length,
            failed: comparisonRequests.filter(r => r.panel === 'LEFT' && r.status === 'failed').length,
            models: [...new Set(comparisonRequests.filter(r => r.panel === 'LEFT').map(r => r.model))]
          },
          RIGHT: {
            total: comparisonRequests.filter(r => r.panel === 'RIGHT').length,
            successful: comparisonRequests.filter(r => r.panel === 'RIGHT' && r.status === 'success').length,
            failed: comparisonRequests.filter(r => r.panel === 'RIGHT' && r.status === 'failed').length,
            models: [...new Set(comparisonRequests.filter(r => r.panel === 'RIGHT').map(r => r.model))]
          }
        }
      });
      
      console.log('📜 [DETAILED HISTORY]');
      
      const byQuestion = new Map<number, TrackedRequest[]>();
      completed.forEach(req => {
        if (!byQuestion.has(req.questionNumber)) {
          byQuestion.set(req.questionNumber, []);
        }
        byQuestion.get(req.questionNumber)!.push(req);
      });
      
      Array.from(byQuestion.entries())
        .sort(([a], [b]) => a - b)
        .forEach(([qNum, requests]) => {
          console.log(`\n  Question #${qNum}:`);
          requests.sort((a, b) => a.startTime - b.startTime).forEach(req => {
            const status = req.status === 'success' ? '✅' : '❌';
            const modeText = req.mode === 'single' ? 'SINGLE' : req.panel;
            console.log(`    ${status} [${modeText}] ${req.model}: "${req.question.substring(0, 30)}..." → ${req.responseLength || 0} chars (${req.duration}ms)`);
          });
        });
    },
    
    isInComparisonMode(): boolean {
      const activeRequests = Array.from(this.activeRequests.values());
      return activeRequests.some(r => r.mode === 'comparison');
    },
    
    getRelatedRequest(requestId: string): TrackedRequest | undefined {
      const request = this.activeRequests.get(requestId) || this.completedRequests.get(requestId);
      if (!request || !request.relatedRequestId) return undefined;
      
      return this.activeRequests.get(request.relatedRequestId) || 
             this.completedRequests.get(request.relatedRequestId);
    },
    
    clear() {
      this.activeRequests.clear();
      this.completedRequests.clear();
      this.questionCounter.clear();
      this.comparisonPairs.clear();
      console.log('🧹 [REQUEST TRACKER] All tracking data cleared');
    }
  };
  
  // Make it globally accessible for debugging
  if (typeof window !== 'undefined') {
    (window as any).REQUEST_TRACKER = REQUEST_TRACKER;
    
    // Add debug function
    (window as any).debugDeFacts = () => {
      console.log('=== DeFacts Debug Summary ===');
      
      // Get all completed DeFacts requests
      const completed = Array.from(REQUEST_TRACKER.completedRequests.values());
      const deFactsRequests = completed.filter(r => r.model === 'DeFacts');
      
      console.log('Total DeFacts requests:', deFactsRequests.length);
      console.log('Failed requests:', deFactsRequests.filter(r => r.status === 'failed').length);
      console.log('Empty responses:', deFactsRequests.filter(r => r.responseLength === 0).length);
      
      // Show each failed request
      deFactsRequests.filter(r => r.status === 'failed' || r.responseLength === 0).forEach(req => {
        console.log(`\nFailed Request #${req.questionNumber}:`, {
          question: req.question,
          duration: req.duration,
          error: req.error,
          responseLength: req.responseLength
        });
      });
    };
  }