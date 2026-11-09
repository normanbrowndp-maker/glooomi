import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../database/prisma.service';
import { webOrigins } from '../auth/web-origins';
@WebSocketGateway({ namespace: '/messages', cors: { origin: (origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void) => { if (!origin || webOrigins().includes(origin)) callback(null, true); else callback(new Error('Origin is not allowed')); }, credentials: true } })
export class MessagesGateway {
  @WebSocketServer() server!: Server;
  constructor(private jwt: JwtService, private db: PrismaService) {}
  async handleConnection(client: Socket) {
    try { const token = client.handshake.auth?.token; if (!token) throw new Error('Unauthorized'); const data = await this.jwt.verifyAsync(token, { secret: process.env.JWT_ACCESS_SECRET }); client.data.userId = data.sub; }
    catch { client.disconnect(true); }
  }
  @SubscribeMessage('conversation:join') async join(@ConnectedSocket() client: Socket, @MessageBody() conversationId: string) {
    const member = await this.db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId: client.data.userId } } });
    if (member) client.join(`conversation:${conversationId}`);
  }
  @SubscribeMessage('message:send') async send(@ConnectedSocket() client: Socket, @MessageBody() data: { conversationId: string; body: string }) {
    const body = data?.body?.trim(); if (!body || body.length > 5000) return;
    const member = await this.db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: data.conversationId, userId: client.data.userId } } });
    if (!member) return;
    const message = await this.db.message.create({ data: { conversationId: data.conversationId, senderId: client.data.userId, body }, include: { sender: { select: { id: true, username: true, profile: true } } } });
    this.server.to(`conversation:${data.conversationId}`).emit('message:new', message);
  }
}
