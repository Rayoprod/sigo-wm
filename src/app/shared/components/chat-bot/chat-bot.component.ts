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

  @ViewChild('chatScroll') private chatScrollContainer!: ElementRef;

  private realtimeChannel: any;

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.cargarHistorialBD();
    this.suscribirRealtime();
  }

  ngOnDestroy() {
    if (this.realtimeChannel) {
      this.supabase.client.removeChannel(this.realtimeChannel);
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
            // Evitar duplicados por seguridad
            if (!this.chatMessages.find((m: any) => m.id === newMsg.id)) {
              this.chatMessages.push({
                id: newMsg.id,
                role: newMsg.role === 'assistant' ? 'ai' : 'user',
                text: newMsg.content
              });
              
              if (newMsg.role === 'assistant') {
                 this.isChatLoading = false;
              }
              
              this.cdr.detectChanges();
              this.scrollToBottom();
            }
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

  async enviarMensajeIA(mensajePredefinido?: string) {
    const userMessage = (mensajePredefinido || this.chatInput).trim();
    if (!userMessage || this.isChatLoading) return;

    // La inserción en la UI se maneja por Realtime
    this.chatInput = '';
    this.isChatLoading = true;
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

      // No hacemos push manual porque Realtime insertará la respuesta.
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
