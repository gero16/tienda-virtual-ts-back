import mongoose from "mongoose";
import colors from "colors"

const dbConnection = async (): Promise<void> => {
  try {
    await mongoose.connect(process.env.MONGODB_CNN as string);
    console.log(colors.yellow('Base de datos Conectada'));
  } catch (error) {
    console.error(error);
    throw new Error('Error a la hora de iniciar la base de datos');
  }
};

module.exports = {
  dbConnection
}
