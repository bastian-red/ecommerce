import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@shop/db';
import type { LoginInput, Role, SignupInput } from '@shop/shared';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, verifyPassword } from './password';

/**
 * A real scrypt hash of a value no user can have. An unknown email is still
 * verified against it, so a login costs the same whether or not the account
 * exists. A bare `if (!user) throw` returns in microseconds and turns the login
 * endpoint into an account-enumeration oracle.
 */
const DUMMY_PASSWORD_HASH = hashPassword('timing-equalizer-not-a-real-password');

export interface SafeUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async signup(input: SignupInput): Promise<SafeUser> {
    try {
      // Role is not accepted from input. Self-service admin signup would be the
      // whole store, one POST away.
      return await this.prisma.user.create({
        data: {
          email: input.email.toLowerCase(),
          name: input.name,
          passwordHash: hashPassword(input.password),
        },
        select: { id: true, email: true, name: true, role: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Email already registered');
      }
      throw error;
    }
  }

  async login(input: LoginInput): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });
    const passwordOk = verifyPassword(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !passwordOk) {
      // One message for both cases: "no such user" tells an attacker which
      // emails are worth a password list.
      throw new UnauthorizedException('Invalid email or password');
    }
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
}
