import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { loginSchema, signupSchema, type LoginInput, type SignupInput } from '@shop/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RATE_LIMITS } from '../config/config';
import { AuthService, type SafeUser } from './auth.service';

/** Tighter than the global budget: these are the brute-force surface. */
const AUTH_RATE_LIMIT = { default: { limit: RATE_LIMITS.auth, ttl: 60_000 } };

/** Credential endpoints consumed by the web app's Auth.js layer. */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle(AUTH_RATE_LIMIT)
  @Post('signup')
  signup(@Body(new ZodValidationPipe(signupSchema)) body: SignupInput): Promise<SafeUser> {
    return this.auth.signup(body);
  }

  @Throttle(AUTH_RATE_LIMIT)
  @Post('login')
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput): Promise<SafeUser> {
    return this.auth.login(body);
  }
}
