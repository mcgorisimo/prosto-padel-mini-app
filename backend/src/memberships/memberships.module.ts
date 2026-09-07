import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsController } from './memberships.controller';

@Module({ imports: [AuthModule], controllers: [MembershipsController] })
export class MembershipsModule {}
