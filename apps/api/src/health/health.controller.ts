import { Controller, Get, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { HealthService } from './health.service';

/**
 * Never rate limited: a monitor or an orchestrator polls this on a fixed
 * interval, and a 429 would read as an outage that is entirely our own doing.
 */
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('health')
  async check(@Res() response: Response): Promise<void> {
    const result = await this.health.check();
    // 503 whenever a dependency is down, so the monitor flags it rather than
    // reporting a green service sitting on a dead database.
    response.status(result.status === 'ok' ? 200 : 503).json(result);
  }
}
