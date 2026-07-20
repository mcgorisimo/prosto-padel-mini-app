import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  HOST: Joi.string().hostname().default('127.0.0.1'),
  PORT: Joi.number().port().default(3000),
  CRM_PROVIDER: Joi.string().valid('disabled').default('disabled'),
  DATABASE_ENABLED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(false),
  DATABASE_URL: Joi.when('DATABASE_ENABLED', {
    is: true,
    then: Joi.string()
      .uri({ scheme: ['postgres', 'postgresql'] })
      .required(),
    otherwise: Joi.string()
      .uri({ scheme: ['postgres', 'postgresql'] })
      .allow('')
      .default(''),
  }),
  TELEGRAM_AUTH_ENABLED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(false),
  TELEGRAM_BOT_TOKEN: Joi.when('TELEGRAM_AUTH_ENABLED', {
    is: true,
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.string().allow('').default(''),
  }),
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: Joi.when('TELEGRAM_AUTH_ENABLED', {
    is: true,
    then: Joi.number().integer().positive().required(),
    otherwise: Joi.number().integer().positive().allow('').default(''),
  }),
});
