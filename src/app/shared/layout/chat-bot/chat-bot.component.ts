import { Component, ElementRef, ViewChild, OnInit, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SidebarModule } from 'primeng/sidebar';
import { InputTextModule } from 'primeng/inputtext';
import { ChipModule } from 'primeng/chip';
import { TooltipModule } from 'primeng/tooltip';
import { SupabaseService } from '../../../core/services/supabase.service';

@Component({
  selector: 'app-chat-bot',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    ButtonModule, 
    SidebarModule, 
    InputTextModule, 
    ChipModule,
    TooltipModule
  ],
  templateUrl: './chat-bot.component.html',
  styleUrl: './chat-bot.component.scss'
})
export class ChatBotComponent implements OnInit, OnDestroy {
  chatVisible = false;
  chatMessages: { id?: string, role: 'user' | 'ai', text: string }[] = [];
  chatInput: string = '';
  isChatLoading = false;
  
  isRecording = false;
  recognition: any;

  @ViewChild('chatScroll') private chatScrollContainer!: ElementRef;
  @ViewChild('chatTextarea') chatTextarea?: ElementRef<HTMLTextAreaElement>;

  private realtimeChannel: any;

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.cargarHistorialBD();
    this.suscribirRealtime();
    this.initSpeechRecognition();
  }

  ngOnDestroy() {
    if (this.realtimeChannel) {
      this.supabase.client.removeChannel(this.realtimeChannel);
    }
    if (this.recognition && this.isRecording) {
      this.recognition.stop();
    }
  }

  private initSpeechRecognition() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false; // Solo escucha una frase a la vez
      this.recognition.interimResults = true; // Muestra los resultados mientras habla
      this.recognition.lang = 'es-PE'; // Español de Perú (o general)

      this.recognition.onstart = () => {
        this.isRecording = true;
        this.cdr.detectChanges();
      };

      this.recognition.onresult = (event: any) => {
        let finalTranscript = '';
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        
        // Si hay un resultado final, lo ponemos. Si no, mostramos lo que va escuchando.
        if (finalTranscript !== '') {
            this.chatInput = finalTranscript;
        } else {
            this.chatInput = interimTranscript;
        }
        this.autoResizeTextarea();
        this.cdr.detectChanges();
      };

      this.recognition.onerror = (event: any) => {
        console.warn('Error en reconocimiento de voz:', event.error);
        this.isRecording = false;
        this.cdr.detectChanges();
      };

      this.recognition.onend = () => {
        this.isRecording = false;
        // Opcional: auto-enviar al terminar de hablar
        // if (this.chatInput.trim().length > 0) this.enviarMensajeIA();
        this.cdr.detectChanges();
      };
    }
  }

  toggleRecording() {
    if (!this.recognition) {
      alert('Tu navegador no soporta el dictado por voz de forma nativa. Te sugerimos usar Chrome.');
      return;
    }

    if (this.isRecording) {
      this.recognition.stop();
    } else {
      this.chatInput = '';
      try {
        this.recognition.start();
      } catch (e) {
        // En caso de que ya esté iniciado por un error de estado
        this.recognition.stop();
      }
    }
  }

  private async cargarHistorialBD() {
    const { data: { user } } = await this.supabase.client.auth.getUser();
    if (!user) return;
    
    const { data } = await this.supabase.client.from('ia_chat_historial')
      .select('*')
      .eq('usuario_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30);
      
    if (data) {
      this.chatMessages = data.reverse().map((msg: any) => ({
        id: msg.id,
        role: msg.role === 'assistant' ? 'ai' : 'user',
        text: msg.content
      }));
      this.cdr.detectChanges();
      this.scrollToBottom();
    }
  }

  private suscribirRealtime() {
    this.supabase.client.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      
      this.realtimeChannel = this.supabase.client.channel('chat_realtime')
        .on('postgres_changes', { 
            event: 'INSERT', 
            schema: 'public', 
            table: 'ia_chat_historial',
            filter: `usuario_id=eq.${user.id}`
          }, 
          (payload: any) => {
            const newMsg = payload.new;
            const rol = newMsg.role === 'assistant' ? 'ai' : 'user';

            // Si el mensaje ya se mostró (inserción optimista desde el fetch),
            // solo reemplazamos el ID temporal por el real de la BD.
            const tempIndex = this.chatMessages.findIndex(
              m => m.id?.startsWith('temp-') && m.role === rol && m.text === newMsg.content
            );
            if (tempIndex !== -1) {
              this.chatMessages[tempIndex].id = newMsg.id;
            } else if (!this.chatMessages.some((m: any) => m.id === newMsg.id)) {
              // Evitar duplicados por seguridad
              this.chatMessages.push({ id: newMsg.id, role: rol, text: newMsg.content });
            }

            if (newMsg.role === 'assistant') {
              this.isChatLoading = false;
            }
            this.cdr.detectChanges();
            this.scrollToBottom();
          }
        )
        .subscribe();
    });
  }

  async limpiarChat() {
    if (confirm('¿Estás seguro de que deseas borrar todo el historial con la IA?')) {
      this.chatMessages = [];
      const { data: { user } } = await this.supabase.client.auth.getUser();
      if (user) {
        await this.supabase.client.from('ia_chat_historial').delete().eq('usuario_id', user.id);
      }
    }
  }

  exportarChat() {
    if (this.chatMessages.length === 0) return;
    
    let content = '=== Historial de Monito ===\n\n';
    this.chatMessages.forEach(msg => {
      const remitente = msg.role === 'ai' ? '🤖 Monito' : '👤 Tú';
      // Limpiar etiquetas HTML básicas de las respuestas de la IA
      const textLimpio = msg.text.replace(/<br>/g, '\n').replace(/<\/?[^>]+(>|$)/g, "");
      content += `${remitente}:\n${textLimpio}\n\n`;
    });

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fecha = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `monito_chat_${fecha}.txt`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  toggleChat() {
    this.chatVisible = !this.chatVisible;
    if (this.chatVisible) {
      this.scrollToBottom();
    }
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      try {
        if (this.chatScrollContainer) {
          this.chatScrollContainer.nativeElement.scrollTop = this.chatScrollContainer.nativeElement.scrollHeight;
        }
      } catch(err) { }
    }, 100);
  }

  handleChatKeydown(event: Event): void {
    // Enter (sin Shift) envía el mensaje; Shift+Enter inserta un salto de línea.
    const e = event as KeyboardEvent;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.enviarMensajeIA();
    }
  }

  autoResizeTextarea(): void {
    const ta = this.chatTextarea?.nativeElement;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }

  async enviarMensajeIA(mensajePredefinido?: string) {
    const userMessage = (mensajePredefinido || this.chatInput).trim();
    if (!userMessage || this.isChatLoading) return;

    // Inserción optimista para que el mensaje del usuario aparezca inmediatamente
    this.chatMessages.push({ id: 'temp-' + Date.now(), role: 'user', text: userMessage });
    
    this.chatInput = '';
    // Resetear la altura del textarea tras enviar
    const ta = this.chatTextarea?.nativeElement;
    if (ta) ta.style.height = 'auto';
    this.isChatLoading = true;
    this.cdr.detectChanges();
    this.scrollToBottom();

    try {
      const isLocalhost = window.location.hostname === 'localhost';
      const apiUrl = isLocalhost ? 'http://localhost:3000/api/chat' : '/api/chat';

      const { data: { session } } = await this.supabase.client.auth.getSession();
      const token = session?.access_token || '';

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ prompt: userMessage })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error de conexión con la IA');
      }

      // Mostramos la respuesta de inmediato (el Realtime solo sincroniza IDs,
      // así el mensaje aparece aunque Realtime falle o tarde en llegar).
      const respuestaIA = data.response;
      if (respuestaIA && !this.chatMessages.some(m => m.role === 'ai' && m.text === respuestaIA)) {
        this.chatMessages.push({ id: 'temp-ai-' + Date.now(), role: 'ai', text: respuestaIA });
      }
    } catch (e: any) {
      console.error(e);
      this.chatMessages.push({ role: 'ai', text: `⚠️ Error: ${e.message}. Intenta nuevamente.` });
      this.isChatLoading = false;
      this.cdr.detectChanges();
      this.scrollToBottom();
    } finally {
      this.isChatLoading = false;
    }
  }
}
