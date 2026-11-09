import { Controller, Get } from '@nestjs/common';
import { EmailQueueService } from './mail/email-queue.service';
import { MailService } from './mail/mail.service';
import { emailDeliveryMode } from './mail/email-delivery-mode';

@Controller('health')
export class HealthController {
  constructor(private mail: MailService, private queue: EmailQueueService) {}
  @Get()
  check() { return { status: 'ok', service: 'gloomi-api', time: new Date().toISOString() }; }

  @Get('email')
  async email() { return { mode: emailDeliveryMode(), smtp: this.mail.health(), redis: await this.queue.health() }; }
}
