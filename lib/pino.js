import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      translateTime: 'SYS:standard',
      ignore: 'hostname,pid',
      singleLine: false,
      colorize: true,
      levelFirst: true,
      append: true,
    },
  },
  level: 'debug',
});

export default logger;
