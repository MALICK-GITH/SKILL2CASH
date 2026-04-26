let ioInstance = null;

export function setSocketServer(io) {
  ioInstance = io;
}

export function notifyUser(userId, event, payload) {
  if (!ioInstance || !userId) return;
  ioInstance.to(`user:${userId}`).emit(event, payload);
}

export function notifyRoom(roomId, event, payload) {
  if (!ioInstance || !roomId) return;
  ioInstance.to(`duel:${roomId}`).emit(event, payload);
}
